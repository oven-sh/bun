// tiny module to shortcut getting access to this boolean without loading the entire node:cluster module
let child: $BunModules["internal/cluster/child"] | undefined;

function loadChild(): $BunModules["internal/cluster/child"] {
  if (child !== undefined) return child;
  if (CAN_BE_CLUSTER_WORKER) {
    child = require("internal/cluster/child");
    if (Bun.isMainThread && process.argv[1] && process.env.NODE_UNIQUE_ID) {
      child._setupWorker();
      // Make sure it's not accidentally inherited by child processes.
      delete process.env.NODE_UNIQUE_ID;
    }
    return child;
  }
  // An executable of a program that never names node:cluster holds nothing of a worker.
  throw Object.assign(
    new Error(
      "Cannot load 'node:cluster': it isn't in this executable. Import it by name somewhere in your program to keep it. (bun compile differs from bun run here: https://bun.com/docs/bundler/aot-compatibility)",
    ),
    { code: "MODULE_NOT_FOUND" },
  );
}

export default {
  isPrimary: !Object.prototype.hasOwnProperty.$call(process.env, "NODE_UNIQUE_ID"),
  loadChild,
};
