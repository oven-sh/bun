// The main thread and a Worker replace the same methods with different functions, in turns: each thread finds its own replacement and never the other's.
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
  const worker = new Worker(new URL(import.meta.url));
  const ask = (request: string) =>
    new Promise<number>(resolve => {
      worker.once("message", resolve);
      worker.postMessage(request);
    });
  note("main at first", total(meters));
  note("the Worker at first", await ask("total"));
  Meter.prototype.read = function () {
    return this.base + 1000;
  };
  note("main after replacing the base method", total(meters));
  note("the Worker after that", await ask("total"));
  note("the Worker after replacing the base method", await ask("base"));
  note("main after that", total(meters));
  note("the Worker after replacing the override", await ask("override"));
  note("main after that", total(meters));
  Double.prototype.read = () => -5;
  note("main after replacing the override", total(meters));
  note("the Worker after that", await ask("total"));
  await worker.terminate();
} else {
  parentPort?.on("message", (request: string) => {
    if (request === "base") {
      Meter.prototype.read = function () {
        return this.base + 100;
      };
    }
    if (request === "override") Double.prototype.read = () => 3;
    parentPort?.postMessage(total(meters));
  });
}
