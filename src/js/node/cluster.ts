// Hardcoded module "node:cluster"

const { isPrimary } = require("internal/cluster/isPrimary");
const child = isPrimary ? undefined : require("internal/cluster/child");
const cluster = child ?? require("internal/cluster/primary");
export default cluster;

//
//

function initializeClusterIPC() {
  // isPrimary was decided when internal/cluster/isPrimary was first loaded (node:net loads it), so
  // NODE_UNIQUE_ID may have been set since; only the child module has _setupWorker.
  if (child && process.argv[1] && process.env.NODE_UNIQUE_ID) {
    child._setupWorker();
    // Make sure it's not accidentally inherited by child processes.
    delete process.env.NODE_UNIQUE_ID;
  }
}

if (Bun.isMainThread) {
  initializeClusterIPC();
}
