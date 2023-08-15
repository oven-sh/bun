import { Worker as NodeWorker } from "node:worker_threads";
import * as tsd from "tsd";

const webWorker = new Worker("./worker.js");

webWorker.addEventListener("message", event => {
  tsd.expectType<MessageEvent>(event);
});
webWorker.addEventListener("error", event => {
  tsd.expectType<ErrorEvent>(event);
});
webWorker.addEventListener("messageerror", event => {
  tsd.expectType<MessageEvent>(event);
});

const nodeWorker = new NodeWorker("./worker.ts");
nodeWorker.on("message", event => {
  console.log("Message from worker:", event);
});
nodeWorker.postMessage("Hello from main thread!");

const workerURL = new URL("worker.ts", import.meta.url).href;
const _worker2 = new Worker(workerURL);

nodeWorker.postMessage("hello");
webWorker.onmessage = event => {
  console.log(event.data);
};

// On the worker thread, `postMessage` is automatically "routed" to the parent thread.
postMessage({ hello: "world" });

// On the main thread
nodeWorker.postMessage({ hello: "world" });

// ...some time later
nodeWorker.terminate();

// Bun.pathToFileURL
const _worker3 = new Worker(new URL("worker.ts", import.meta.url).href, {
  ref: true,
  smol: true,
  credentials: "",
  name: "a name",
  env: {
    envValue: "hello",
  },
});

export { nodeWorker as worker, _worker2, _worker3 };
