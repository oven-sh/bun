// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The name of the module stands in a constant. The path is written from the folder of the file, which names the file by itself, and the Worker starts.
// The build said nothing here and left the file out.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const name = "node:worker_threads";
const { Worker: Thread } = require(name);
const worker = new Thread(__dirname + "/../job.js");
worker.on("message", said => (console.log(said), worker.terminate()));
