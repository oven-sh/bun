// The main thread and a Worker replace the same methods with different functions, in turns: each thread finds its own replacement and never the other's. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const ask = (request: string) =>
    new Promise<number>(resolve => {
      worker.once("message", resolve);
      worker.postMessage(request);
    });
  note(total(meters));
  note(await ask("total"));
  Meter.prototype.read = function () {
    return this.base + 1000;
  };
  note(total(meters));
  note(await ask("total"));
  note(await ask("base"));
  note(total(meters));
  note(await ask("override"));
  note(total(meters));
  Double.prototype.read = () => -5;
  note(total(meters));
  note(await ask("total"));
  await worker.terminate();
  console.log(checksum);
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
