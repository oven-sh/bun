// Hardcoded module "node:cluster"

const child_process = require("node:child_process");

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const NumberParseInt = Number.parseInt;

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

function setupChildProcessIpcChannel() {
  if (process.env.NODE_CHANNEL_FD) {
    const fd = NumberParseInt(process.env.NODE_CHANNEL_FD, 10);
    $assert(fd >= 0);

    // Make sure it's not accidentally inherited by child processes.
    delete process.env.NODE_CHANNEL_FD;

    const serializationMode = process.env.NODE_CHANNEL_SERIALIZATION_MODE || "json";
    delete process.env.NODE_CHANNEL_SERIALIZATION_MODE;

    child_process._forkChild(fd, serializationMode);
    $assert(process.send);
  }
}

if (Bun.isMainThread && process.env.BUN_CLUSTER) {
  setupChildProcessIpcChannel();
  initializeClusterIPC();
  delete process.env.BUN_CLUSTER;
}
