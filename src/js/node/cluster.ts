// Hardcoded module "node:cluster"
// This is a stub
// We leave it in here to provide a better error message
// TODO: implement node cluster
import EventEmitter from "node:events";
import { throwNotImplemented } from "../shared";

export var SCHED_NONE = 0,
  SCHED_RR = 1,
  Worker,
  schedulingPolicy = 2,
  isWorker = false,
  isPrimary = true,
  isMaster = true,
  cluster;

Worker = function Worker() {
  throwNotImplemented("node:cluster Worker", 2428);
};

// TODO: is it okay for this to be a class?
class Cluster extends EventEmitter {
  static isWorker = false;
  static isPrimary = true;
  static isMaster = true;

  static Worker = Worker;

  fork() {
    throwNotImplemented("node:cluster", 2428);
  }

  disconnect() {
    throwNotImplemented("node:cluster", 2428);
  }

  setupMaster() {
    throwNotImplemented("node:cluster", 2428);
  }

  settings = {};
  workers = {};
  SCHED_NONE = 0;
  SCHED_RR = 1;
  schedulingPolicy = 2;
  // @ts-expect-error
  [Symbol.for("CommonJS")] = 0;
}

cluster = new Cluster();

export { cluster as default };
