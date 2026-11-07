// Build prints: 0 x warn: TS100084: This Worker may start from code in a text: a data: or blob: URL, or the text of a Worker with eval: true. That code isn't compiled, so it runs in the interpreter. To compile it, move it to a file and write the path as new URL("./file", import.meta.url)
// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker } from "node:worker_threads";
const port = "require('node:worker_threads').parentPort";
const worker = new Worker(port + ".postMessage(1 + 1)", { eval: true });
worker.on("message", said => (console.log("said", said), worker.terminate()));
