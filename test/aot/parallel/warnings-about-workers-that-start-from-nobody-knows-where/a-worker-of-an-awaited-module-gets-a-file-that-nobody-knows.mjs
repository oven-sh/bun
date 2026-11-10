// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The constructor is read off the awaited module, so what the build points at is the start, not the load.
const { Worker } = await import("node:worker_threads");
if (process.argv.length > 5) new Worker(process.argv[5]);
console.log("none started");
