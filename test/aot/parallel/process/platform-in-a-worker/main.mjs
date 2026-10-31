// The main thread assigns process.platform and starts a worker, which has a process of its own.
// Entry points: ./worker.mjs
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker } from "node:worker_threads";
import { describe } from "./shared.mjs";
console.log("main thread: " + describe());
process.platform = "made up";
process.arch = "made up";
console.log("main thread, after an assignment: " + describe());
console.log("worker: " + (await new Promise((resolve, reject) => {
  const worker = new Worker("./worker.mjs");
  worker.once("message", resolve);
  worker.once("error", reject);
})));
console.log("main thread, after the worker: " + describe());
