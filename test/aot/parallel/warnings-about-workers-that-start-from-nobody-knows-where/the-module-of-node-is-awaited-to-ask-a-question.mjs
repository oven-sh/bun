// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The module is loaded late to ask whether this is the main thread. No Worker is made, and nothing of the module goes anywhere.
const { isMainThread } = await import("node:worker_threads");
console.log(isMainThread);
