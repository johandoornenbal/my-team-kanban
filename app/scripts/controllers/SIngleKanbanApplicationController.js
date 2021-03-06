'use strict';

angular.module('mpk').controller('SingleKanbanApplicationController',
	function ApplicationController($scope, $window, kanbanRepository, pollingService, themesProvider, $routeParams, $location, cloudService, $translate, $timeout, uuidService) {

    /* SETTINGS */
    $scope.maxAttemptsBeforeSelfFree = 10;
    $scope.checkForBackendChangesTime = 1000;
    $scope.autoSaveTime = 1000;
    $scope.connectionLostTime = 10000;
    $scope.timeBeforeWatchingAndPolling = 1000;

    /* END SETTINGS */


    $scope.allCards = [];
    $scope.allColumns = [];
    $scope.allCardListeners = [];
    $scope.allColumnListeners = [];
    $scope.allChangedCards = [];
    $scope.allChangedColumns = [];

    $scope.freeToSave = false;
    $scope.failedFreeAttempt = 0;
    $scope.somethingToSave = [];

    $scope.noCardWatch = true; // do not watch right after (re-)loading -  no changes have to be persisted in backend
    $scope.noColumnWatch = true; // do not watch right after (re-)loading -  no changes have to be persisted in backend

    $scope.connectionLost = false;
    $scope.timeStampLastSave = new Date().getTime();

	$scope.colorOptions = ['FFFFFF','DBDBDB','FFB5B5', 'FF9E9E', 'FCC7FC', 'FC9AFB', 'CCD0FC', '989FFA', 'CFFAFC', '9EFAFF', '94D6FF','C1F7C2', 'A2FCA3', 'FAFCD2', 'FAFFA1', 'FCE4D4', 'FCC19D'];
    $scope.reloading = false; /* flag to indicate that changes to scope are due to reloading after loading data from backend */
    $scope.reloadNoSave = false; /* flag set by pol() and unset by $scope.$watch to indicate that changes to scope are due to reloading and are not to be saved */

	// <-------- Checking the pollingservice for backend for changes ---------------> //
    var checkForBackendChanges = function() {
        $timeout(function() {
            var time = new Date().getTime();
            if (time > pollingService.getMyTimeStamp() + $scope.connectionLostTime){
            	$scope.$broadcast("connectionLost");
            	$scope.connectionLost = true;
            } else {
                if ($scope.connectionLost){
                    $scope.$broadcast("connectionFound");
                    $scope.connectionLost = false;
                }
            }
            if (
                pollingService.getChange()
                && pollingService.getSelfChangeInProgress() !== true
                && pollingService.getPolledTimeStampChange() > $scope.timeStampLastSave + 100 // allow 100 for back-end save
            ) {
                $scope.reloadNoSave = true;
                kanbanRepository.loadKanban($routeParams.kanbanId).then(function(data){
                    pollingService.setPauze(true);
                    $scope.reloading = true;
                    reload(data);
                    pollingService.setNoChange();
                    pollingService.setPauze(false);
                });
            }
//            console.log('lastchange: ' + $scope.timeStampLastSave + ' serverTimeStamp: ' + pollingService.getPolledTimeStampChange());
//            console.log('change=' + pollingService.getChange() + " selfChange=" + pollingService.getSelfChangeInProgress());
            checkForBackendChanges();
        }, $scope.checkForBackendChangesTime);
    };
    checkForBackendChanges();

/*
    var testLocking = function(){

        kanbanRepository.getLock($scope.kanban.id).then(function(data){
            console.log(data);
            if (data == 'free'){
               kanbanRepository.setLock($scope.kanban.id).then(function(data){
                   console.log(data);
               });
            } else {
                 kanbanRepository.unLock($scope.kanban.id).then(function(data){
                     console.log(data);
                 });
            };
        });

        $timeout(function(){
            testLocking();
        }, 5000);

    }
    $timeout(function(){
        testLocking();
    }, 2000);

*/

    var autosave = function(){
        $timeout(function(){

            if ($scope.allChangedCards.length > 0) {
                $scope.somethingToSave.push("cardAndColumns");
            }

            if ($scope.allChangedColumns.length > 0) {
                $scope.somethingToSave.push("cardAndColumns");
            }

            if ($scope.somethingToSave.length > 0){

                attemptSave();

            }
            unLock();

            autosave();

        }, $scope.autoSaveTime);
    }
    autosave();

    var attemptSave = function(){
                return kanbanRepository
                    .getLock($scope.kanban.id)
                    .then(function(data){
                        console.log(data);
                        if (data == 'free'){
                            $scope.failedFreeAttempt = 0;
                            $scope.freeToSave = true;
                            pollingService.setPauze(true);
                            setLock();
                        } else {
                            $scope.freeToSave = false;
                            $scope.failedFreeAttempt ++;
                        }
                        console.log("free to save : " + $scope.freeToSave);
                    });
            }

    var setLock = function(){
                if ($scope.freeToSave){
                    return kanbanRepository
                     .setLock($scope.kanban.id)
                     .then(function(data){
                         console.log(data);
                         if (data == kanbanRepository.browser){
                            $scope.lockset = true;
                            saveAll();
                         } else {
                            $scope.lockset = false;
                         }
                         console.log("lock set : " + $scope.lockset);
                     });
                } else { return null;}
    }


    var unLock = function(){
                 if (($scope.freeToSave && $scope.lockset) || $scope.failedFreeAttempt > $scope.maxAttemptsBeforeSelfFree){
                     $scope.failedFreeAttempt = 0;
                     return kanbanRepository
                          .unLock($scope.kanban.id)
                          .then(function(data){

                              $scope.freeToSave = false;
                              $scope.lockset = false;
                              pollingService.setPauze(false);

                              console.log("unlock done " + data);
                          });
                 } else { return null;}
     }



    var saveAll = function(){

        console.log("saving ..." + $scope.somethingToSave);
        $scope.$broadcast('saveColumnsAndCards');
        $scope.somethingToSave = [];

    }

    // <-------- Backend saving events ---------------> //
    /*
        The events are:
        - change in column
        - change in card
        - card deleted
        - users changed
        - archive changed
        - kanban settings changed
    */

    $scope.$on('saveColumnsAndCards', function(){
        var i;
        var cardToSave;
        var columnToSave;

        var allCardsToSave = $scope.allChangedCards.slice();
        for (i=0; i < allCardsToSave.length; i++){
            cardToSave = allCardsToSave[i];
            kanbanRepository.saveCard(cardToSave, $scope.kanban.id).then(
                function(data){
                    console.log(data);
                });
            $scope.allChangedCards.splice(0,1);
            console.log($scope.allChangedCards);
        }

        var allColumnsToSave = $scope.allChangedColumns.slice();
        for (i=0; i < allColumnsToSave.length; i++){
            columnToSave = allColumnsToSave[i];
            if (columnToSave.id == undefined) {
                columnToSave.id = uuidService.generateUUID();
            }
            kanbanRepository.saveColumn(columnToSave, $scope.kanban.id).then(
                function(data){
                    console.log(data);
                });
            $scope.allChangedColumns.splice(0,1);
        }
    });

    $scope.$on('ColumnAdded', function(){
            kanbanRepository.updateKanban($scope.kanban).then(
                function(data){
                    console.log(data);
                });
    });

    $scope.$on('cardDeleted', function(e, cardId){
        kanbanRepository.deleteCard(cardId, $scope.kanban.id).then(
            function(data){
                console.log(data);
            });
    });

    $scope.$on('ColumnDeleted', function(e, columnId){
        kanbanRepository.deleteColumn(columnId, $scope.kanban.id).then(
            function(data){
                console.log(data);
            });
        kanbanRepository.updateKanban($scope.kanban).then(
            function(data){
                console.log(data);
            });
    });

    $scope.$on('usersChanged', function(){
        kanbanRepository.saveUsers($scope.kanban).then(
            function(data){
                console.log(data);
            });
    });

    $scope.$on('archiveChanged', function(){
        kanbanRepository.saveArchive($scope.kanban).then(
            function(data){
                console.log(data);
            });
    });

    $scope.$on('kanbanSettingsChanged', function(){
        kanbanRepository.saveSettings($scope.kanban).then(
            function(data){
                console.log(data);
            });
    });

    // <-------- Backend connection actions ---------------> //

    $scope.$on('connectionLost', function(){
        $translate("CONNECTION_LOST").then(function successFn(translation) {
                $scope.errorMessage = translation;
                $scope.infoMessage = '';
                $scope.showError = true;
                $scope.showInfo = true;
        });
    });

    $scope.$on('connectionFound', function(){
        $translate("CONNECTION_FOUND").then(function successFn(translation) {
                $scope.infoMessage = translation;
                $scope.errorMessage = '';
                $scope.showInfo = true;
                $scope.showError = false;
                $timeout(function() {
                    $scope.showInfo = false;
                }, $scope.connectionLostTime);
        });
    });

    // <-------- Kanban changed actions ---------------> //

	$scope.$on('ColumnsChanged', function(){
		$scope.columnWidth = calculateColumnWidth($scope.kanban.columns.length);
		detectChangesInColumns();
	});

	$scope.$on('newCardAdded', function(){
    	detectChangesInCards();
    });


	function calculateColumnWidth(numberOfColumns){
		return Math.floor((100 / numberOfColumns) * 100) / 100;
	}

	// <-------- Kanban menu actions ---------------> //

	$scope.kanbanMenu = {};

	$scope.kanbanMenu.openSwitchTheme = function(){
		$scope.$broadcast('OpenSwitchTheme', kanbanRepository.getTheme());
	};
	$scope.kanbanMenu.openArchive = function (kanban){
		$scope.$broadcast('OpenArchive', kanban);
	};
	$scope.kanbanMenu.openUsers = function (kanban){
    	$scope.$broadcast('openUsers', kanban);
    };

	$scope.openKanbanShortcut = function($event){
		$scope.$broadcast('TriggerOpen');
	};

	$scope.openHelpShortcut = function($event){
 		$scope.$broadcast('TriggerHelp');
 	};
	
	// <-------- Handling different events in this block ---------------> //
	$scope.spinConfig = {lines: 10, length: 3, width: 2, radius:5};

	var currentKanban = new Kanban('Kanban name', 0);

    var loadedRepo;

    // using db repo
    loadedRepo = kanbanRepository.loadKanban($routeParams.kanbanId).then(function(data){

        kanbanRepository.kanbansByName = data.singlekanban;
        kanbanRepository.theme = data.theme;
        kanbanRepository.lastUpdated = data.lastUpdated;

        $scope.kanban = kanbanRepository.getSingle();

        $scope.columnHeight = angular.element($window).height() - 110;
        $scope.columnWidth = calculateColumnWidth($scope.kanban.columns.length);

        $scope.triggerOpen = function(){
            $scope.$broadcast('TriggerOpenKanban');
        };

        if (kanbanRepository.getTheme() != undefined && kanbanRepository.getTheme() != ''){
            themesProvider.setCurrentTheme(kanbanRepository.getTheme());
        }

        // take 1 second in order to load from db and set up the listeners - then start polling and listening for changes
        $timeout(function() {
            pollingService.poll($scope.kanban.id);
            $scope.noCardWatch = false;
            $scope.noColumnWatch = false;
        }, $scope.timeBeforeWatchingAndPolling);

        detectChangesInCards();
        detectChangesInColumns();

    });


	var reload = function(data){

        kanbanRepository.kanbansByName = data.singlekanban;
        kanbanRepository.theme = data.theme;
        kanbanRepository.lastUpdated = data.lastUpdated;

        $scope.kanban = kanbanRepository.getSingle();

        $scope.columnHeight = angular.element($window).height() - 110;
        $scope.columnWidth = calculateColumnWidth($scope.kanban.columns.length);

        if (kanbanRepository.getTheme() != undefined && kanbanRepository.getTheme() != ''){
            themesProvider.setCurrentTheme(kanbanRepository.getTheme());
        }

        $scope.reloading = false;
        $scope.noCardWatch = true; // do not watch right after (re-)loading -  no changes have to be persisted in backend
        $scope.noColumnWatch = true; // do not watch right after (re-)loading -  no changes have to be persisted in backend

        detectChangesInCards();
        detectChangesInColumns();

        $timeout(function() {
            $scope.noCardWatch = false;
            $scope.noColumnWatch = false;
        }, $scope.timeBeforeWatchingAndPolling);

    };

    var detectChangesInCards = function(){
        var $i;
        var $t;

        // unregister all card listeners and empty allCards array
        for ($i=0; $i<$scope.allCardListeners.length; $i++){
            $scope.allCardListeners[$i]();
            $scope.allCards = [];
        }

        // fill allCards array (again)
        for ($i=0; $i < $scope.kanban.columns.length; $i++){
            for ($t=0; $t<$scope.kanban.columns[$i].cards.length; $t++){
                $scope.allCards.push($scope.kanban.columns[$i].cards[$t]);
            }
        }

        // detect change in a single card - register listeners (again)
        for ($i=0; $i<$scope.allCards.length; $i++){
            $scope.allCardListeners.push($scope.$watch('allCards[' + $i + ']', function(newValue, oldValue){
                if (!$scope.noCardWatch){

                    /* prevent column watcher from seeing this change*/
                    $scope.noColumnWatch = true;
                    if (searchById(newValue.id, $scope.allChangedCards)>=0){
                        $scope.allChangedCards.splice(searchById(newValue.id, $scope.allChangedCards), 1);
                    }
                    $scope.allChangedCards.push(newValue);

                    /* prevent column watcher from seeing this change: a little timeout before watching for changes again*/
                    $timeout(function(){
                        $scope.noColumnWatch = false;
                    },10);
                }
            }, true));

        }
    };

    var detectChangesInColumns = function(){

         var $i;

         // unregister all column listeners
         for ($i=0; $i<$scope.allColumnListeners.length; $i++){
             $scope.allColumnListeners[$i]();
         }

         // detect change in a single column - register listeners (again)
         for ($i=0; $i < $scope.kanban.columns.length; $i++){
             $scope.allColumnListeners.push($scope.$watch('kanban.columns['+ $i  + ']', function(newValue, oldValue){
                if (!$scope.noColumnWatch){
                    if (searchByName(newValue.name, $scope.allChangedColumns)>=0){
                        $scope.allChangedColumns.splice(searchByName(newValue.name, $scope.allChangedColumns), 1);
                    }
                    $scope.allChangedColumns.push(newValue);
                }
             }, true));
         }
    };

    var searchById = function search(idSearchFor, myArray){
        for (var i=0; i < myArray.length; i++) {
            if (myArray[i].id === idSearchFor) {
                return i;
            }
        }
        return -1;
    };

    var searchByName = function search(nameSearchFor, myArray){
        for (var i=0; i < myArray.length; i++) {
            if (myArray[i].name === nameSearchFor) {
                return i;
            }
        }
        return -1;
    };

});
