// Three Workers replace, delete and put back methods in endless loops and are terminated in the middle of that. The main thread calls the same methods all the time and keeps the originals, and a Worker that is started afterwards finds them too. One number is printed.
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

function start(task: string): { worker: Worker; answer: Promise<number>; closed: Promise<void> } {
  const worker = new Worker(new URL(import.meta.url));
  const answer = new Promise<number>(resolve => (worker.onmessage = event => resolve(event.data)));
  const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
  worker.postMessage(task);
  return { worker, answer, closed };
}

const meters: Meter[] = [new Meter(5), new Double(6), new Plain(7)];

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (Bun.isMainThread) {
  const endless = [start("endless"), start("endless"), start("endless")];
  for (const { answer } of endless) note(await answer);
  let wrong = 0;
  for (let i = 0; i < 300000; i++) if (total(meters) !== 26) wrong++;
  for (const { worker } of endless) worker.terminate();
  for (let i = 0; i < 300000; i++) if (total(meters) !== 26) wrong++;
  for (const { closed } of endless) await closed;
  note(wrong);
  const last = start("once");
  note(await last.answer);
  last.worker.terminate();
  await last.closed;
  note(total(meters));
  console.log(checksum);
} else {
  addEventListener("message", (event: MessageEvent<string>) => {
    postMessage(total(meters));
    if (event.data !== "endless") return;
    const ofMeter = Meter.prototype.read;
    const ofDouble = Double.prototype.read;
    for (let round = 0; ; round++) {
      Meter.prototype.read = () => round;
      Reflect.deleteProperty(Double.prototype, "read");
      if (total(meters) !== 3 * round) throw new Error("a Worker lost its own replacement");
      Meter.prototype.read = ofMeter;
      Double.prototype.read = ofDouble;
    }
  });
}

export {};
