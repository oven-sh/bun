// Hardcoded module "node:cluster"

const { isPrimary } = require("internal/cluster/isPrimary");
const cluster = isPrimary ? require("internal/cluster/primary") : require("internal/cluster/child");
export default cluster;

//
//

function initializeClusterIPC() {
  if (process.argv[1] && process.env.NODE_UNIQUE_ID) {
    cluster._setupWorker();
    // Make sure it's not accidentally inherited by child processes.
    delete process.env.NODE_UNIQUE_ID;

    process.channel.unref();
  }
}

if (Bun.isMainThread) {
  initializeClusterIPC();
}
