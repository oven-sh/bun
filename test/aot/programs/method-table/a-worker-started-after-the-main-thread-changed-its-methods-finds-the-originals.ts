// The main thread replaces one method, deletes another and covers a third on an instance, and only then starts Workers: each Worker finds every method as the classes define it.
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

function totalInAWorker(): Promise<number> {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url));
    worker.onmessage = event => {
      worker.terminate();
      resolve(event.data);
    };
  });
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

if (Bun.isMainThread) {
  note("main at first", total(meters));
  Meter.prototype.read = function () {
    return this.base + 100;
  };
  Reflect.deleteProperty(Double.prototype, "read");
  meters[2].read = () => -1;
  note("main after its changes", total(meters));
  note("the first Worker", await totalInAWorker());
  Double.prototype.read = () => 0;
  note("main after one more", total(meters));
  note("the second Worker", await totalInAWorker());
  note("main at the end", total(meters));
} else {
  postMessage(total(meters));
}

export {};
