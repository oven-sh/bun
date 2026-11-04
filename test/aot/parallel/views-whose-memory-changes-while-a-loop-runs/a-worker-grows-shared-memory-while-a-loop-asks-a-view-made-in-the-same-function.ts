import { Worker, isMainThread, workerData } from "node:worker_threads";
function spin(shared: SharedArrayBuffer) { const view = new Uint8Array(shared); let turns = 0; while (view.length === 4) turns++; return (turns > 0) + ":" + view.length; }
function spinAgainstOneInFront(shared: SharedArrayBuffer) { const view = new Uint8Array(shared); const inFront = view.length; let turns = 0; while (view.length === inFront) turns++; return (turns > 0) + ":" + view.length; }
if (isMainThread) {
  const shared = new SharedArrayBuffer(4, { maxByteLength: 64 });
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(spin(shared));
  console.log(spinAgainstOneInFront(shared));
  await worker.terminate();
} else {
  setTimeout(() => (workerData as SharedArrayBuffer).grow(8), 100);
  setTimeout(() => (workerData as SharedArrayBuffer).grow(16), 300);
}
