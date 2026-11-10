import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const view = new Int16Array(new SharedArrayBuffer(16, { maxByteLength: 64 }));
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", (m: string) => { console.log(m); worker.terminate(); });
  worker.postMessage(view);
} else {
  parentPort!.on("message", (view: any) => { let s = 0; for (let i = 0; i < view.length; i++) s += view[i] + 1; parentPort!.postMessage("" + s); });
}
