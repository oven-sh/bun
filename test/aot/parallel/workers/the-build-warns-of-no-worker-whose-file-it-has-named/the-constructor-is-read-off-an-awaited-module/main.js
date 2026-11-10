// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load has read the constructor off the awaited module and followed the URL to the file, and the Worker starts.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const { Worker } = await import("node:worker_threads");
const worker = new Worker(new URL("../job.js", import.meta.url));
worker.on("message", said => (console.log(said), worker.terminate()));
