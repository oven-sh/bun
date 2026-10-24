// A holder calls a method, makes a call, and calls the method again. In a worker the call in between replaces the method on the prototype object, which is the worker's own. The main thread runs the same code before, meanwhile and afterwards.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

class Square {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}

let strikes = false;
function between(): number {
  if (strikes) Square.prototype.area = () => -1;
  return 1;
}
function holder(s: Square): string {
  const before = s.area();
  const got = between();
  return before + ">" + s.area() + "," + got;
}
function run(damages: boolean): string {
  let text = "";
  for (let round = 0; round < 200; round++) {
    strikes = damages && round === 150;
    const line = holder(new Square(round));
    if (round === 149 || round === 150 || round === 199) text += line + " ";
  }
  return text;
}

if (isMainThread) {
  console.log("main, at first: " + run(false));
  const worker = new Worker(new URL(import.meta.url), { workerData: true });
  const answer = new Promise<string>(resolve => worker.once("message", resolve));
  console.log("main, meanwhile: " + run(false));
  console.log("the worker: " + (await answer));
  await worker.terminate();
  console.log("main, afterwards: " + run(false));
} else {
  parentPort?.postMessage(run(workerData === true));
}

export {};
