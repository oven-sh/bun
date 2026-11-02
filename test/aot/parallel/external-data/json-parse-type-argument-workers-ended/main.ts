// Json parse type argument in workers that are ended.
// Entry points: ./worker.ts
// Reference: bun build --compile
import { Worker } from "node:worker_threads";
import { rows, work } from "./work";

const small = rows(500);
let ended = 0;
let wrong = 0;
for (let turn = 0; turn < 40; turn++) {
  const worker = new Worker("./worker.ts");
  await new Promise<void>(resolve => worker.once("message", () => resolve()));
  await new Promise<void>(resolve => setTimeout(resolve, (turn * 7) % 60));
  if (work(small) !== 500) wrong++;
  await worker.terminate();
  ended++;
  if (work(small) !== 500) wrong++;
}
console.log(ended + " Workers ended, " + wrong + " wrong answers on the main thread");
