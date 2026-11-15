import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const sent = new DataView(new ArrayBuffer(32, { maxByteLength: 64 }), 8, 16);
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", (m: string) => { console.log("SAID " + m); worker.terminate(); });
  worker.postMessage(sent);
} else {
  parentPort!.on("message", (view: any) => { view.buffer.resize(8); let length; try { length = view.byteLength; } catch (error) { length = (error as Error).name; } parentPort!.postMessage(String(length)); });
}
