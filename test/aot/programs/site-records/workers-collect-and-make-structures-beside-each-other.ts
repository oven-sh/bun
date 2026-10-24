// Several Workers run the same sites at the same time. Each teaches them short-lived structures and closures, collects, and sends their successors through. A Worker's collection clears what that Worker's sites learned and nothing of the others'.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

interface Holder {
  wanted: unknown;
  act(): unknown;
}

function wantedOf(holder: Holder): unknown {
  return holder.wanted;
}
function setWanted(holder: Holder, to: unknown): void {
  holder.wanted = to;
}
function act(holder: Holder): unknown {
  return holder.act();
}
function call(callee: () => unknown): unknown {
  return callee();
}

function made(worker: number, round: number, index: number): Holder {
  const holder: any = {};
  holder["w" + worker + "r" + round + "i" + index] = "not wanted";
  if ((index + worker) % 3 === 0) holder.pad = "not wanted";
  if ((index + worker) % 3 === 1) holder.act = () => "early " + index;
  holder.wanted = index * worker;
  holder.act ??= () => "late " + index;
  return holder;
}

function work(worker: number): string {
  let wrong = 0;
  let sum = 0;
  const honest: Holder = { wanted: "honest", act: () => "honest acts" };
  for (let round = 0; round < 12; round++) {
    const kept: Holder[] = [];
    for (let index = 0; index < 400; index++) {
      const holder = made(worker, round, index);
      if (index % 2) kept.push(holder);
      if (wantedOf(holder) !== index * worker) wrong++;
      setWanted(holder, index + round);
      if (wantedOf(holder) !== index + round) wrong++;
      const expected = ((index + worker) % 3 === 1 ? "early " : "late ") + index;
      if (act(holder) !== expected) wrong++;
      if (call(holder.act) !== expected) wrong++;
      if (call(() => index) !== index) wrong++;
      sum += index + round;
    }
    if (wantedOf(honest) !== "honest" || act(honest) !== "honest acts") wrong++;
    Bun.gc(true);
    for (const holder of kept) if (typeof wantedOf(holder) !== "number" || typeof act(holder) !== "string") wrong++;
  }
  return "worker " + worker + ": wrong " + wrong + ", sum " + sum;
}

function start(worker: number): Promise<string> {
  return new Promise(resolve => {
    const thread = new Worker(new URL(import.meta.url), { workerData: worker });
    thread.once("message", (answer: string) => {
      void thread.terminate().then(() => resolve(answer));
    });
  });
}

if (isMainThread) {
  const others = [start(1), start(2), start(3), start(4)];
  console.log(work(0).replace("worker 0", "main"));
  for (const answer of await Promise.all(others)) console.log(answer);
  console.log(work(5).replace("worker 5", "main again"));
} else {
  parentPort?.postMessage(work(Number(workerData)));
}

export {};
