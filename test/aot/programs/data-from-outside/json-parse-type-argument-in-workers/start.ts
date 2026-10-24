import { Worker } from "node:worker_threads";
import { work } from "./work";

const answers: string[] = [];
let waiting = 4;
for (let number = 0; number < 4; number++) {
  const worker = new Worker("./main.ts", { workerData: number + 1 });
  worker.on("message", (message: string) => {
    answers[number] = message;
    if (--waiting) return;
    for (const answer of answers) console.log("worker: " + answer);
    console.log("main again: " + work(9));
  });
}
console.log("main: " + work(0));
