// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// Whoever loads this file gets the module object with its constructor, so the build points at the alias.
import threads = require("node:worker_threads");
console.log(threads.isMainThread);
export { threads };
