import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  globalThis.__ofTheMainThread = 1;
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", message => { console.log("worker:", message, "main:", typeof globalThis.__ofTheWorker, typeof globalThis.__ofTheMainThread); });
} else {
  globalThis.__ofTheWorker = () => 2;
  parentPort.postMessage([typeof globalThis.__ofTheWorker, typeof globalThis.__ofTheMainThread].join());
}
