// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/cluster.ts


// Hardcoded module "node:cluster"
// This is a stub
// We leave it in here to provide a better error message
// TODO: implement node cluster
const EventEmitter = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 20/*node:events*/) || __intrinsic__createInternalModuleById(20/*node:events*/));
const { throwNotImplemented } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 6/*internal/shared.ts*/) || __intrinsic__createInternalModuleById(6/*internal/shared.ts*/));

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

$$EXPORT$$(new Cluster()).$$EXPORT_END$$;
