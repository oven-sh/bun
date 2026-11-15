// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The Worker of node:worker_threads is a class of Bun's own library: the engine sees no start in the program. The load, which follows the names, speaks where it cannot.
import { Worker } from "node:worker_threads";
if (process.argv.length > 5) new Worker(process.argv[5]);
console.log("none started");
