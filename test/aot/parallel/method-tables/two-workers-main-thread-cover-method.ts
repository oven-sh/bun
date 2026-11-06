// Three threads run the same module. Each covers read() with a member of its own on a different one of its three objects, and only that object of that thread changes.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

class Meter {
  constructor(public base: number) {}
  read(): number {
    return this.base + 1;
  }
}
class Double extends Meter {
  read(): number {
    return this.base * 2;
  }
}
class Plain extends Meter {}

function readOf(meter: Meter): number {
  return meter.read();
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

function cover(index: number): number[] {
  const seen: number[] = [];
  for (const meter of meters) seen.push(readOf(meter));
  meters[index].read = () => 1000 * (index + 1);
  for (const meter of meters) seen.push(readOf(meter));
  return seen;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

if (isMainThread) {
  const answers: Promise<number[]>[] = [];
  const workers: Worker[] = [];
  for (const index of [1, 2]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: index });
    workers.push(worker);
    answers.push(new Promise(resolve => worker.once("message", resolve)));
  }
  for (const seen of cover(0)) note("main", seen);
  for (const answer of answers) for (const seen of await answer) note("a Worker", seen);
  for (const meter of meters) note("main afterwards", readOf(meter));
  for (const worker of workers) await worker.terminate();
} else {
  parentPort?.postMessage(cover(workerData));
}
