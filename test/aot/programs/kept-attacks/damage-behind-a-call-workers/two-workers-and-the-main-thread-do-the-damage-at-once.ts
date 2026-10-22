// Two workers and the main thread run the same loop at the same time, and each does the damage to its own objects in rounds of its own. What each holder reads depends on its own thread alone.
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
function touch(p: Point, list: number[]): number {
  if (strikes) {
    (p as any).x = "text";
    list.push(0.5);
  }
  return 1;
}
function holder(p: Point, list: number[]): string {
  const before = p.x + list[0];
  const got = touch(p, list);
  return before + ">" + p.x + "," + list.length + "," + list[list.length - 1] + "," + got;
}
function run(every: number): string {
  let struck = 0;
  let digest = 0;
  for (let round = 0; round < 20000; round++) {
    strikes = round % every === 0;
    const line = holder(new Point(round, 1), [round, 1]);
    if (line.includes("text")) struck++;
    digest = (digest * 31 + line.length) | 0;
  }
  return every + ": " + struck + " " + digest;
}

if (isMainThread) {
  const workers = [7, 11].map(every => new Worker(new URL(import.meta.url), { workerData: every }));
  const answers = workers.map(worker => new Promise<string>(resolve => worker.once("message", resolve)));
  console.log("main " + run(13));
  for (const answer of answers) console.log("worker " + (await answer));
  for (const worker of workers) await worker.terminate();
} else {
  parentPort?.postMessage(run(workerData as number));
}

export {};
