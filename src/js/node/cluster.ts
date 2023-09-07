// Hardcoded module "node:cluster"
// This is a stub
// We leave it in here to provide a better error message
// TODO: implement node cluster
const EventEmitter = require("node:events");
const { throwNotImplemented } = require("$shared");

// TODO: is it okay for this to be a class?
class Cluster extends EventEmitter {
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

export default new Cluster();
