// The main thread and a worker run the same typed functions. Only the worker does the damage, to objects of its own. Both tell what their holders read.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function touch(p: Point): number {
  if (strikes) delete (p as any).x;
  return 1;
}
function holder(p: Point): string {
  const before = p.x;
  const got = touch(p);
  return before + ">" + p.x + "," + (p.x + p.y + got);
}
function run(damages: boolean): string {
  let text = "";
  for (let round = 0; round < 300; round++) {
    strikes = damages && round % 100 === 99;
    const line = holder(new Point(round, 1));
    if (round % 100 === 99) text += line + " ";
  }
  return text;
}

if (isMainThread) {
  console.log("main, at first: " + run(false));
  const answer = await new Promise<string>(resolve => {
    const worker = new Worker(new URL(import.meta.url), { workerData: true });
    worker.once("message", (told: string) => void worker.terminate().then(() => resolve(told)));
  });
  console.log("the worker: " + answer);
  console.log("main, afterwards: " + run(false));
  console.log("main, with damage of its own: " + run(true));
} else {
  parentPort?.postMessage(run(workerData === true));
}

export {};
