// src/js/node/cluster.js
var { EventEmitter } = import.meta.require("node:events");

class TODO extends Error {
  constructor(message = "node:cluster is not implemented yet in Bun. Track the status: https://github.com/oven-sh/bun/issues/2428") {
    super(message);
    this.name = "TODO";
  }
}
var SCHED_NONE = 0;
var SCHED_RR = 1;
var Worker;
var schedulingPolicy = 2;
var isWorker = false;
var isPrimary = true;
var isMaster = true;
var cluster;
Worker = function Worker2() {
  throw new TODO("Worker is not implemented yet in Bun");
};

class Cluster extends EventEmitter {
  static isWorker = false;
  static isPrimary = true;
  static isMaster = true;
  static Worker = Worker;
  fork() {
    throw new TODO;
  }
  disconnect() {
    throw new TODO;
  }
  setupMaster() {
    throw new TODO;
  }
  settings = {};
  workers = {};
  SCHED_NONE = 0;
  SCHED_RR = 1;
  schedulingPolicy = 2;
  [Symbol.for("CommonJS")] = 0;
}
cluster = new Cluster;
export {
  schedulingPolicy,
  isWorker,
  isPrimary,
  isMaster,
  cluster as default,
  cluster,
  Worker,
  SCHED_RR,
  SCHED_NONE
};

//# debugId=E6BA42911150B46964756e2164756e21
