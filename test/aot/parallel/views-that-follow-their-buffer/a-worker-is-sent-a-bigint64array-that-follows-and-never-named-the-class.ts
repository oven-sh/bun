import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const view = new BigInt64Array(new ArrayBuffer(16, { maxByteLength: 64 }));
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", (m: string) => { console.log(m); worker.terminate(); });
  worker.postMessage(view);
} else {
  parentPort!.on("message", (view: any) => { parentPort!.postMessage(view.length + "," + String(view[1])); });
}
