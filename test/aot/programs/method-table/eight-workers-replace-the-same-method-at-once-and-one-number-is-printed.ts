// Eight Workers start together and wait for one another. Then each replaces the same two methods with functions of its own two thousand times and checks after every change that it finds its own and nobody else's. The main thread does the same with the originals. One number is printed.
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

function total(meters: Meter[]): number {
  let sum = 0;
  for (const meter of meters) sum += meter.read();
  return sum;
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];
const count = 8;

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  const arrived = new Int32Array(new SharedArrayBuffer(4));
  const answers: Promise<number>[] = [];
  for (let number = 1; number <= count; number++) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { number, arrived } });
    answers.push(new Promise(resolve => worker.once("message", resolve)));
  }
  let wrong = 0;
  while (Atomics.load(arrived, 0) < count) if (total(meters) !== 26) wrong++;
  for (let i = 0; i < 200000; i++) if (total(meters) !== 26) wrong++;
  note(wrong);
  for (const answer of answers) note(await answer);
  note(total(meters));
  console.log(checksum);
} else {
  const { number, arrived }: { number: number; arrived: Int32Array } = workerData;
  const ofDouble = Double.prototype.read;
  let wrong = total(meters) === 26 ? 0 : 1;
  Atomics.add(arrived, 0, 1);
  Atomics.notify(arrived, 0);
  for (let n = Atomics.load(arrived, 0); n < count; n = Atomics.load(arrived, 0)) Atomics.wait(arrived, 0, n);
  for (let round = 0; round < 2000; round++) {
    Meter.prototype.read = () => number * 10000 + round;
    if (total(meters) !== 2 * (number * 10000 + round) + 12) wrong++;
    Double.prototype.read = () => number;
    if (total(meters) !== 2 * (number * 10000 + round) + number) wrong++;
    Double.prototype.read = ofDouble;
  }
  parentPort?.postMessage(wrong);
}
