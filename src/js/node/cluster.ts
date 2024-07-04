// Hardcoded module "node:cluster"

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;

const childOrPrimary = ObjectPrototypeHasOwnProperty.$call(process.env, "NODE_UNIQUE_ID");
const cluster = childOrPrimary ? require("internal/cluster/child") : require("internal/cluster/primary");
export default cluster;

//
//

function initializeClusterIPC() {
  if (process.argv[1] && process.env.NODE_UNIQUE_ID) {
    cluster._setupWorker();
    // Make sure it's not accidentally inherited by child processes.
    delete process.env.NODE_UNIQUE_ID;
  }
}

if (Bun.isMainThread) {
  initializeClusterIPC();
}
