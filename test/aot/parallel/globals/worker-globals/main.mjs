// A worker has its own globals.
// Entry points: ./worker.mjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker } from "node:worker_threads";
import { kind, read, store } from "./shared.mjs";
globalThis.place = "main thread";
const before = [read(), read()];
const fromWorker = await new Promise((resolve, reject) => {
  const worker = new Worker("./worker.mjs");
  worker.once("message", resolve);
  worker.once("error", reject);
});
console.log(before.join());
console.log(fromWorker);
console.log(read(), kind());
store("stored on the main thread");
console.log(read(), globalThis.place);
