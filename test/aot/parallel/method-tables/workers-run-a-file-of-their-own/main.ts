// Entry points: ./worker.ts
// Reference: bun build --compile
import { Worker } from "node:worker_threads";
import { Double, make, total } from "./meters";

const meters = make();
console.log("main at first: " + total(meters));
Double.prototype.read = () => -1;
console.log("main after its change: " + total(meters));
const answers: Promise<number[]>[] = [];
for (const number of [0, 1, 2, 3]) {
  const worker = new Worker("./worker.ts", { workerData: number });
  answers.push(new Promise(resolve => worker.once("message", resolve)));
}
for (const answer of answers) console.log("a Worker: " + (await answer).join(" "));
console.log("main at the end: " + total(meters) + " " + total(make()));
