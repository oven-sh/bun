// Hardcoded module "node:cluster"

// This is a stub
// We leave it in here to provide a better error message
// TODO: implement node cluster
const { EventEmitter } = import.meta.require("node:events");
class TODO extends Error {
  constructor(
    message = "node:cluster is not implemented yet in Bun. Track the status: https://github.com/oven-sh/bun/issues/2428",
  ) {
    super(message);
    this.name = "TODO";
  }
}

export var SCHED_NONE = 0,
  SCHED_RR = 1,
  Worker,
  schedulingPolicy = 2,
  isWorker = false,
  isPrimary = true,
  isMaster = true,
  cluster;

Worker = function Worker() {
  throw new TODO("Worker is not implemented yet in Bun");
};

// TODO: is it okay for this to be a class?
class Cluster extends EventEmitter {
  static isWorker = false;
  static isPrimary = true;
  static isMaster = true;

  static Worker = Worker;

  fork() {
    throw new TODO();
  }

  disconnect() {
    throw new TODO();
  }

  setupMaster() {
    throw new TODO();
  }

  settings = {};
  workers = {};
  SCHED_NONE = 0;
  SCHED_RR = 1;
  schedulingPolicy = 2;
  [Symbol.for("CommonJS")] = 0;
}

cluster = new Cluster();

export { cluster as default };
