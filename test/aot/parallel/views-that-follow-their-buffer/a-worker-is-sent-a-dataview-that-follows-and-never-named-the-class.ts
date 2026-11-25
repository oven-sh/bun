import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const sent = new DataView(new ArrayBuffer(16, { maxByteLength: 64 }));
  sent.setInt8(1, 7);
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", (m: string) => { console.log("SAID " + m); worker.terminate(); });
  worker.postMessage(sent);
} else {
  parentPort!.on("message", (view: any) => { view.buffer.resize(32); parentPort!.postMessage(view.byteLength + "," + view.getInt8(1) + "," + view.byteOffset); });
}
