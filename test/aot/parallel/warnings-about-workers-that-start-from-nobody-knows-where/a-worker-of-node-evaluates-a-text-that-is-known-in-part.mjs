// Build prints: 1 x warn: TS100084: This Worker may start from code in a text: a data: or blob: URL, or the text of a Worker with eval: true. That code isn't compiled, so it runs in the interpreter. To compile it, move it to a file and write the path as new URL("./file", import.meta.url)
import { Worker } from "node:worker_threads";
const port = "require('node:worker_threads').parentPort";
if (process.argv.length > 5) new Worker(port + ".postMessage(" + process.argv.length + ")", { eval: true });
console.log("none started");
