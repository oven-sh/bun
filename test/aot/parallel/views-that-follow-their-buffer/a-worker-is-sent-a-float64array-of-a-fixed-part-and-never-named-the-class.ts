import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const view = new Float64Array(new ArrayBuffer(32, { maxByteLength: 64 }), 8, 2);
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", (m: string) => { console.log(m); worker.terminate(); });
  worker.postMessage(view);
} else {
  parentPort!.on("message", (view: any) => { view.buffer.resize(8); parentPort!.postMessage(view.length + "," + view.byteOffset); });
}
