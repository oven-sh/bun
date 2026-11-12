// Build prints: 1 x warn: TS100084: This Worker may start from code in a text: a data: or blob: URL, or the text of a Worker with eval: true. That code isn't compiled, so it runs in the interpreter. To compile it, move it to a file and write the path as new URL("./file", import.meta.url)
// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Worker } from "node:worker_threads";
if (process.argv.length > 5) new Worker(process.argv[5], { eval: true });
console.log("none started");
