var EventEmitter = require("node:events");

// src/js/shared.ts
function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/cluster.ts
var SCHED_NONE = 0, SCHED_RR = 1, Worker, schedulingPolicy = 2, isWorker = !1, isPrimary = !0, isMaster = !0, cluster;
Worker = function Worker2() {
  throwNotImplemented("node:cluster Worker", 2428);
};

class Cluster extends EventEmitter {
  constructor() {
    super(...arguments);
  }
  static isWorker = !1;
  static isPrimary = !0;
  static isMaster = !0;
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

//# debugId=737065ADCE807CA764756e2164756e21
