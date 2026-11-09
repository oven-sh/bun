import { Worker, isMainThread, workerData } from "node:worker_threads";
function waitFor(ctl, k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let turns = 0;
  while (Atomics.load(ctl, 0) !== k) turns = (turns + 1) | 0;
  let mixed = turns ^ (turns >>> 7);
  mixed = (mixed + (turns & 255)) | 0;
  mixed = (mixed ^ (mixed << 3)) | 0;
  mixed = (mixed + (mixed >>> 11)) | 0;
  return mixed & 1;
}
function step(data, ctl, k) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const view = new Int32Array(data);
  const before = view.length;
  Atomics.store(ctl, 1, k); waitFor(ctl, k);
  return view.length - before;
}
if (isMainThread) {
  const data = new SharedArrayBuffer(4, { maxByteLength: 4096 });
  const control = new SharedArrayBuffer(8);
  const worker = new Worker(new URL(import.meta.url), { workerData: { data, control } });
  const ctl = new Int32Array(control);
  let grown = 0;
  for (let k = 1; k <= 300; k++) grown += step(data, ctl, k);
  console.log(grown);
  worker.terminate();
} else {
  const ctl = new Int32Array(workerData.control);
  for (let k = 1; k <= 300; k++) {
    while (Atomics.load(ctl, 1) !== k) {}
    workerData.data.grow(4 + 4 * k);
    Atomics.store(ctl, 0, k);
    Atomics.notify(ctl, 0);
  }
}
