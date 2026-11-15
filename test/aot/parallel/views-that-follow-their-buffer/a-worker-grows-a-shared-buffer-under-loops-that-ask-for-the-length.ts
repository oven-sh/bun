// Guards: a typed array over a SharedArrayBuffer that another thread grows is kept out of what reads its length once.
import { Worker, isMainThread, workerData } from "node:worker_threads";
function spin(view: Uint8Array): string { const was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function spinOnOwnView(shared: SharedArrayBuffer): string { const view = new Int32Array(shared), was = view.length; let turns = 0; while (view.length === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.length > was); }
function sumWhileItGrows(view: Uint8Array): string { const was = view.length; let total = 0, i = 0; for (; i < view.length && i < 3e9; i++) { total += view[i] + 1; if (i === was - 1) { const end = Date.now() + 400; while (Date.now() < end); } } return (i > was) + " " + (total === i); }
if (isMainThread) {
  const shared = new SharedArrayBuffer(64, { maxByteLength: 65536 }), view = new Uint8Array(shared);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log(spin(view)); console.log(spinOnOwnView(shared)); console.log(sumWhileItGrows(view));
  await worker.terminate();
} else {
  const shared = workerData as SharedArrayBuffer;
  setInterval(() => { if (shared.byteLength < 60000) shared.grow(shared.byteLength + 64); }, 100);
}
