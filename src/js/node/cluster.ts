// Hardcoded module "node:cluster"
import type ClusterChild from "internal/cluster/child";
import type ClusterType from "internal/cluster/primary";

const { isPrimary } = require("internal/cluster/isPrimary");
const cluster: typeof ClusterChild | typeof ClusterType = isPrimary ? require("internal/cluster/primary") : require("internal/cluster/child");

// The setup logic runs *in the worker* when NODE_UNIQUE_ID is present.
// This environment variable is set by the primary process when forking workers.
if (!isPrimary && process.env.NODE_UNIQUE_ID) {
  // In this context, `cluster` is guaranteed to be the ClusterChild module.
  // The _setupWorker method initializes IPC for the worker process.
  (cluster as typeof ClusterChild)._setupWorker();
  // Make sure it's not accidentally inherited by child processes.
  delete process.env.NODE_UNIQUE_ID;
}

// Export as 'any' to avoid TS4023 error due to the internal ClusterChild type.
// Consumers importing 'node:cluster' typically rely on @types/node for type information.
export default cluster as any;