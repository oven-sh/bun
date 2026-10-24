import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { inc, obj } from "./shared.js";
if (isMainThread) {
  inc(); inc(); inc();
  const w = new Worker(new URL(import.meta.url));
  w.on("message", m => { console.log("worker says", m); console.log("main has", inc(), obj.n, obj.list.join()); });
  w.on("error", e => console.log("worker error", e.message));
} else {
  parentPort.postMessage([inc(), obj.n, obj.list.join()].join(" "));
}
