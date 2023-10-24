(function (){"use strict";// build2/tmp/node/cluster.ts
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);
var { throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);

class Cluster extends EventEmitter {
  constructor() {
    super(...arguments);
  }
  isWorker = false;
  isPrimary = true;
  isMaster = true;
  workers = {};
  settings = {};
  SCHED_NONE = 1;
  SCHED_RR = 2;
  schedulingPolicy = 2;
  Worker = function Worker() {
    throwNotImplemented("node:cluster Worker", 2428);
  };
  setupPrimary() {
    throwNotImplemented("node:cluster", 2428);
  }
  setupMaster() {
    throwNotImplemented("node:cluster", 2428);
  }
  fork() {
    throwNotImplemented("node:cluster", 2428);
  }
  disconnect() {
    throwNotImplemented("node:cluster", 2428);
  }
}
return new Cluster})
