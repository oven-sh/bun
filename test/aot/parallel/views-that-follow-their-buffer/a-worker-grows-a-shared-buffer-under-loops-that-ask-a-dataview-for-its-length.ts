import { Worker, isMainThread, workerData } from "node:worker_threads";
function spin(view: DataView): string { const was = view.byteLength; let turns = 0; while (view.byteLength === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.byteLength > was); }
function spinOnOwnView(shared: SharedArrayBuffer): string { const view = new DataView(shared), was = view.byteLength; let turns = 0; while (view.byteLength === was && turns < 3e9) turns++; return (turns < 3e9) + " " + (view.byteLength > was); }
if (isMainThread) {
  const shared = new SharedArrayBuffer(64, { maxByteLength: 65536 }), view = new DataView(shared);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  console.log("SAID " + spin(view) + " " + spinOnOwnView(shared));
  await worker.terminate();
} else {
  const shared = workerData as SharedArrayBuffer;
  setInterval(() => { if (shared.byteLength < 60000) shared.grow(shared.byteLength + 64); }, 100);
}
