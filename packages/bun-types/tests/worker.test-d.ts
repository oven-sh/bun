import { Worker } from "node:worker_threads";

const workerthread = new Worker("./worker.js");

const worker = new Worker("./worker.ts");
worker.addEventListener("message", (event: MessageEvent) => {
  console.log("Message from worker:", event.data);
});
worker.postMessage("Hello from main thread!");

const workerURL = new URL("worker.ts", import.meta.url).href;
const _worker2 = new Worker(workerURL);

worker.postMessage("hello");
worker.onmessage = event => {
  console.log(event.data);
};

// On the worker thread, `postMessage` is automatically "routed" to the parent thread.
postMessage({ hello: "world" });

// On the main thread
worker.postMessage({ hello: "world" });

// ...some time later
worker.terminate();

// Bun.pathToFileURL
const _worker3 = new Worker(new URL("worker.ts", import.meta.url).href, {
  ref: true,
  smol: true,
});

export { worker, _worker2, _worker3 };
