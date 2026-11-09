// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The alias is a require() under a name. The load reads what the program takes off the name, as it does behind a require().
import threads = require("node:worker_threads");
console.log(threads.isMainThread, threads.threadId);
