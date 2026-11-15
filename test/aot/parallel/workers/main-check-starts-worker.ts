// The usual split of one file into the main thread and its worker.
import { parentPort, Worker, workerData } from "node:worker_threads";

if (import.meta.main) {
  const depth = (workerData ?? 0) + 1;
  if (depth > 2) throw new Error("a worker started a worker");
  const worker = new Worker(import.meta.filename, { workerData: depth });
  worker.once("message", answer => {
    console.log("from the worker:", answer);
    worker.terminate();
  });
} else {
  parentPort!.postMessage(6 * 7);
}
