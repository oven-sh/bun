// The main thread replaces a method and starts a Worker; the Worker finds the original, replaces it in its own way and starts a Worker of its own, which finds the original again, and so on three levels down. Each level hands up what it and the levels below it saw. One number is printed.
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

async function level(depth: number): Promise<number[]> {
  const seen = [total(meters)];
  Meter.prototype.read = function () {
    return this.base + 100 * depth;
  };
  if (depth % 2 === 1) Reflect.deleteProperty(Double.prototype, "read");
  seen.push(total(meters));
  if (depth < 4) {
    const worker = new Worker(new URL(import.meta.url), { workerData: depth + 1 });
    seen.push(...(await new Promise<number[]>(resolve => worker.once("message", resolve))));
    await worker.terminate();
  }
  seen.push(total(meters));
  return seen;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  for (const seen of await level(1)) note(seen);
  console.log(checksum);
} else {
  parentPort?.postMessage(await level(workerData));
}
