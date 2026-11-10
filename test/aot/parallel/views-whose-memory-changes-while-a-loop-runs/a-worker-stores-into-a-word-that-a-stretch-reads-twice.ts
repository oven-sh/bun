// Under: --aot-check=Validate: the check that reads a reused load again took a word that a worker had stored into meanwhile for a fault of the compiler, and stopped a right program
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
function watch(shared: Int32Array, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++)
    for (let at = 0; at < shared.length; at++) { const first = shared[at]!; const second = shared[at]!; sum = ((sum ^ first) + second) | 0; }
  return sum;
}
if (isMainThread) {
  const words = new Int32Array(new SharedArrayBuffer(64));
  const writer = new Worker(new URL(import.meta.url), { workerData: words });
  writer.on("message", (said: string) => {
    if (said !== "begun") { void writer.terminate(); return; }
    const sum = watch(words, 3_000_000);
    Atomics.store(words, 15, 1);
    console.log(`watched ${typeof sum}`);
  });
} else {
  const words = workerData as Int32Array;
  parentPort!.postMessage("begun");
  while (Atomics.load(words, 15) === 0) for (let at = 0; at < 15; at++) words[at] = (words[at]! + 1) | 0;
  parentPort!.postMessage("ended");
}
