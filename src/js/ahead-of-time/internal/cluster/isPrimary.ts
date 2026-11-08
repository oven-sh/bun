// What the compiler reads in place of src/js/internal/cluster/isPrimary.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 962977b6d711da04a77d5853d54a989de2083d15d5cb146695e93a9e2ea203c7.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

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
  throw $MODULE_NOT_FOUND(
    "Cannot load 'node:cluster': it isn't in this executable. Import it by name somewhere in your program to keep it. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)",
  );
}

export default {
  // Such an executable can only say that it is no worker. Without a channel nobody is there to be a worker of.
  isPrimary: CAN_BE_CLUSTER_WORKER
    ? !Object.prototype.hasOwnProperty.$call(process.env, "NODE_UNIQUE_ID")
    : !Object.prototype.hasOwnProperty.$call(process.env, "NODE_UNIQUE_ID") || !process.connected,
  loadChild,
};
