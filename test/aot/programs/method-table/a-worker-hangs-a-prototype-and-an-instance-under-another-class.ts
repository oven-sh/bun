// A Worker gives a prototype, and then one instance, another parent. In the Worker their calls find other methods; on the main thread nothing moves.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

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

function total(meters: Meter[]): number {
  let sum = 0;
  for (const meter of meters) sum += meter.read();
  return sum;
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

if (isMainThread) {
  note("main at first", total(meters));
  const worker = new Worker(new URL(import.meta.url));
  for (const seen of await new Promise<number[]>(resolve => worker.once("message", resolve))) note("the Worker saw", seen);
  note("main afterwards", total(meters));
  note("a new object on the main thread", new Plain(10).read());
  await worker.terminate();
} else {
  const seen = [total(meters)];
  Object.setPrototypeOf(Plain.prototype, Double.prototype);
  seen.push(total(meters));
  seen.push(new Plain(10).read());
  Object.setPrototypeOf(meters[0], Double.prototype);
  seen.push(total(meters));
  Object.setPrototypeOf(Plain.prototype, Meter.prototype);
  seen.push(total(meters));
  parentPort?.postMessage(seen);
}
