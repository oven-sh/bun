import { Worker } from "node:worker_threads";
import { describe } from "./parse";

console.log(describe("main").join("\n"));
const answers: string[][] = [];
let waiting = 3;
for (let number = 0; number < 3; number++) {
  const worker = new Worker("./main.ts", { workerData: number });
  worker.on("message", (message: string[]) => {
    answers[number] = message;
    if (--waiting) return;
    for (const answer of answers) console.log(answer.join("\n"));
    console.log(describe("main afterwards").join("\n"));
  });
}
