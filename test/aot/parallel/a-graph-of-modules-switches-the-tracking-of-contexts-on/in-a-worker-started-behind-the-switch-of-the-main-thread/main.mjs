// A Worker has an engine of its own: that the main thread tracks contexts says nothing there.
import { AsyncLocalStorage } from "node:async_hooks";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { readAll } from "./shapes.mjs";
if (isMainThread) {
  new AsyncLocalStorage().run("w", () => {});
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", line => console.log("the Worker:", line));
  await new Promise(done => worker.on("exit", done));
  await readAll(line => console.log("the main thread:", line));
} else {
  await readAll(line => parentPort.postMessage(line));
}
