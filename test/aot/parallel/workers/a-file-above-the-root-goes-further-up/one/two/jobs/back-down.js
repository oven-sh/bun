// ../three/back-into-the-folder-of-the-entry-point/main.js starts this file as a Worker, and it starts one of its own from a file beside that entry point. Run as a program it has no parent.
import { parentPort } from "node:worker_threads";
if (!parentPort) console.log("no parent");
else {
  const worker = new Worker(new URL("../three/back-into-the-folder-of-the-entry-point/inner.js", import.meta.url));
  worker.onmessage = event => (parentPort.postMessage("the job > " + event.data), worker.terminate());
  worker.onerror = event => (event.preventDefault(), parentPort.postMessage("the job > error"));
}
