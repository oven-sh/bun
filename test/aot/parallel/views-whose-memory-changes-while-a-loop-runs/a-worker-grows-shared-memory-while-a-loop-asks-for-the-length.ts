import { Worker, isMainThread, workerData } from "node:worker_threads";
function spin(view: Uint8Array) { let turns = 0; while (view.length === 4) turns++; return turns > 0; }
function sum(view: Uint8Array) { let total = 0; for (let i = 0; i < view.length; i++) total += view[i] + 1; return total; }
if (isMainThread) {
  const shared = new SharedArrayBuffer(4, { maxByteLength: 64 });
  const view = new Uint8Array(shared);
  for (let i = 0; i < 20000; i++) sum(view);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(spin(view), view.length, sum(view));
  await worker.terminate();
} else {
  setTimeout(() => (workerData as SharedArrayBuffer).grow(8), 100);
}
