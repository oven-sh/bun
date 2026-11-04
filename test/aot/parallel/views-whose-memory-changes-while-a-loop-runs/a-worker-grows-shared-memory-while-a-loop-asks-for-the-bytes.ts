import { Worker, isMainThread, workerData } from "node:worker_threads";
function spinOnView(view: Int32Array) { let turns = 0; while (view.byteLength === 8) turns++; return turns > 0; }
function spinOnData(data: DataView) { let turns = 0; while (data.byteLength === 16) turns++; return turns > 0; }
if (isMainThread) {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  const view = new Int32Array(shared);
  const data = new DataView(shared);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(spinOnView(view), view.byteLength, view.length);
  console.log(spinOnData(data), data.byteLength);
  await worker.terminate();
} else {
  setTimeout(() => (workerData as SharedArrayBuffer).grow(16), 100);
  setTimeout(() => (workerData as SharedArrayBuffer).grow(32), 300);
}
