// Three threads run the same module. Each covers read() with a member of its own on a different one of its three objects, and only that object of that thread changes. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  const answers: Promise<number[]>[] = [];
  const workers: Worker[] = [];
  for (const index of [1, 2]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: index });
    workers.push(worker);
    answers.push(new Promise(resolve => worker.once("message", resolve)));
  }
  for (const seen of cover(0)) note(seen);
  for (const answer of answers) for (const seen of await answer) note(seen);
  for (const meter of meters) note(readOf(meter));
  for (const worker of workers) await worker.terminate();
  console.log(checksum);
} else {
  parentPort?.postMessage(cover(workerData));
}
