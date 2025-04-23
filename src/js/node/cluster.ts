// Hardcoded module "node:cluster"

const { isPrimary } = require("internal/cluster/isPrimary");

// Define NodeJS.Cluster interface for TypeScript type checking
interface NodeJSCluster extends EventEmitter {
  isWorker: boolean;
  isMaster: boolean;
  isPrimary: boolean;
  worker?: any;
  workers?: Record<string | number, any>;
  Worker: any;
  _setupWorker?: () => void;
  // Add any other properties needed
}

const cluster = (isPrimary ? require("internal/cluster/primary") : require("internal/cluster/child")) as NodeJSCluster;
export default cluster;

//
//

function initializeClusterIPC() {
  if (process.argv[1] && process.env.NODE_UNIQUE_ID) {
    // Use type assertion to fix the TypeScript error
    (cluster as NodeJSCluster & { _setupWorker: () => void })._setupWorker();
    // Make sure it's not accidentally inherited by child processes.
    delete process.env.NODE_UNIQUE_ID;
  }
}

if (Bun.isMainThread) {
  initializeClusterIPC();
}
