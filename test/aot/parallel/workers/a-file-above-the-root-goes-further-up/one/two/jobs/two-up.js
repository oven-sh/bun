// The programs under ../three start this file as a Worker, and it starts one of its own: two folders above itself. Run as a program it has no parent.
import { parentPort } from "node:worker_threads";
if (!parentPort) console.log("no parent");
else {
  const worker = new Worker(new URL("../../helper.js", import.meta.url));
  worker.onmessage = event => (parentPort.postMessage("the job > " + event.data), worker.terminate());
  worker.onerror = event => (event.preventDefault(), parentPort.postMessage("the job > error"));
}
