// A Worker replaces Meter.prototype.read and an override of it while the main thread calls both in a loop: the main thread keeps the originals before, during and after. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  const flags = new Int32Array(new SharedArrayBuffer(8));
  note(total(meters));
  const worker = new Worker(new URL(import.meta.url), { workerData: flags });
  await new Promise(resolve => worker.once("message", resolve));
  const answer = new Promise<number[]>(resolve => worker.once("message", resolve));
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  let wrong = 0;
  while (Atomics.load(flags, 1) === 0) if (total(meters) !== 26) wrong++;
  for (let i = 0; i < 100000; i++) if (total(meters) !== 26) wrong++;
  note(wrong);
  for (const seen of await answer) note(seen);
  note(total(meters));
  await worker.terminate();
  note(total(meters));
  console.log(checksum);
} else {
  const flags: Int32Array = workerData;
  const seen = [total(meters)];
  parentPort?.postMessage("ready");
  Atomics.wait(flags, 0, 0);
  Meter.prototype.read = function () {
    return this.base + 100;
  };
  seen.push(total(meters));
  Double.prototype.read = () => 7;
  seen.push(total(meters));
  Atomics.store(flags, 1, 1);
  parentPort?.postMessage(seen);
}
