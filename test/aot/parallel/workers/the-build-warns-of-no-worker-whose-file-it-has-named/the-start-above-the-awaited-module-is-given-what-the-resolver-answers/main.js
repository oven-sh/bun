// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The start stands above the load in the text and is given what require.resolve() answers. The load reads that name where it is written, at the
// start as well, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const start = () => new Thread(require.resolve("../job.js"));
const { Worker: Thread } = await import("node:worker_threads");
const worker = start();
worker.on("message", said => (console.log(said), worker.terminate()));
