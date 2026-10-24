// The main thread replaces, deletes and puts back methods while a Worker calls them in a loop: the Worker keeps the originals all the time. One number is printed.
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

if (Bun.isMainThread) {
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL(import.meta.url));
  const next = () => new Promise<number>(resolve => (worker.onmessage = event => resolve(event.data)));
  const calling = next();
  worker.postMessage(stop);
  note(await calling);
  const finished = next();
  const original = Double.prototype.read;
  for (let round = 0; round < 1000; round++) {
    Meter.prototype.read = () => round;
    Reflect.deleteProperty(Double.prototype, "read");
    if (total(meters) !== 3 * round) note(round);
    Double.prototype.read = original;
  }
  note(total(meters));
  Atomics.store(stop, 0, 1);
  note(await finished);
  worker.terminate();
  console.log(checksum);
} else {
  addEventListener("message", (event: MessageEvent<Int32Array>) => {
    const stop = event.data;
    postMessage(total(meters));
    let wrong = 0;
    while (Atomics.load(stop, 0) === 0) if (total(meters) !== 26) wrong++;
    for (let i = 0; i < 100000; i++) if (total(meters) !== 26) wrong++;
    postMessage(wrong);
  });
}

export {};
