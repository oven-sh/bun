import { Worker } from "node:worker_threads";
import { COLORS, describe } from "./names";

console.log(describe("main"));
const answers: string[][] = [];
let waiting = 4;
for (let number = 0; number < 4; number++) {
  const worker = new Worker("./main.ts", { workerData: number });
  worker.on("message", (message: string[]) => {
    answers[number] = message;
    if (--waiting) return;
    for (const answer of answers) console.log(answer.join("\n"));
    console.log(describe("main afterwards"));
    COLORS.add("gray");
    console.log(describe("main changed"));
  });
}
