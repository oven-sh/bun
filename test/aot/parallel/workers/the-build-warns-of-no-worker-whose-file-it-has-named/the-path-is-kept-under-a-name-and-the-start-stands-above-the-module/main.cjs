// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The path is kept under a name, and the start stands above the require() in the text. The load follows the name to the path, which names the
// file by itself, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { join } = require("node:path");
const FILE = join(__dirname, "..", "job.js");
function start() {
  return new Thread(FILE);
}
const { Worker: Thread } = require("node:worker_threads");
const worker = start();
worker.on("message", said => (console.log(said), worker.terminate()));
