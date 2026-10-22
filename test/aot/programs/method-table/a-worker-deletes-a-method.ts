// A Worker deletes an override, so that its objects find the method of the parent, and then the method of the parent, so that a call throws a TypeError. The main thread keeps both.
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

function attempt(run: () => number): number {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

if (isMainThread) {
  note("main at first", total(meters));
  const worker = new Worker(new URL(import.meta.url));
  for (const seen of await new Promise<number[]>(resolve => worker.once("message", resolve))) note("the Worker saw", seen);
  note("main afterwards", attempt(() => total(meters)));
  note("a new object on the main thread", new Double(10).read());
  await worker.terminate();
} else {
  const seen = [total(meters)];
  Reflect.deleteProperty(Double.prototype, "read");
  seen.push(total(meters));
  Reflect.deleteProperty(Meter.prototype, "read");
  seen.push(attempt(() => total(meters)));
  seen.push(attempt(() => new Double(10).read()));
  parentPort?.postMessage(seen);
}
