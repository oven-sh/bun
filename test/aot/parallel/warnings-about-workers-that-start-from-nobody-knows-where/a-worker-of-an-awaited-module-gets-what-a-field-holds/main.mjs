// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The path goes through a field, which the load does not follow. The warning stands at the start, and the file that the path names is in the executable
// because a start is out of sight.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
class Pool {
  file = require.resolve("./job.mjs");
  start() {
    return new Thread(this.file);
  }
}
const { Worker: Thread } = await import("node:worker_threads");
const worker = new Pool().start();
worker.on("message", said => (console.log(said), worker.terminate()));
