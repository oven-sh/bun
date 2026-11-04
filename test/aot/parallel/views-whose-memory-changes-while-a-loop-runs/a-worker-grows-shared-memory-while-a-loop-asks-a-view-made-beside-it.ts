import { Worker, isMainThread, workerData } from "node:worker_threads";
if (isMainThread) {
  const shared = new SharedArrayBuffer(4, { maxByteLength: 64 });
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  const view = new Uint8Array(shared);
  const inFront = view.length;
  let turns = 0;
  while (view.length === inFront) turns++;
  console.log(turns > 0, view.length);
  await worker.terminate();
} else {
  setTimeout(() => (workerData as SharedArrayBuffer).grow(8), 100);
}
