// Five Workers run one after the other. Each replaces a method and ends; the next one, which may get the memory of the one before, finds the original again.
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

function inAWorker(more: number): Promise<number[]> {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url));
    let answer: number[] = [];
    worker.onmessage = event => {
      answer = event.data;
      worker.terminate();
    };
    worker.addEventListener("close", () => resolve(answer));
    worker.postMessage(more);
  });
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

if (Bun.isMainThread) {
  for (let more = 100; more <= 500; more += 100) {
    for (const seen of await inAWorker(more)) note("a Worker saw", seen);
    note("main", total(meters));
  }
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    const more = event.data;
    const seen = [total(meters)];
    Meter.prototype.read = function () {
      return this.base + more;
    };
    Double.prototype.read = () => more;
    seen.push(total(meters));
    postMessage(seen);
  });
}

export {};
