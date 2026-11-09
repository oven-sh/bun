// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load reads what the program takes off the name and off the awaited value, as it does behind a require().
const threads = await import("worker_threads");
console.log(threads.isMainThread, threads.threadId, (await import("node:worker_threads")).parentPort);
