// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// Whoever is handed the module object has its constructor.
const unseen = (0, eval)("(threads) => typeof threads.Worker");
console.log(unseen(await import("node:worker_threads")));
