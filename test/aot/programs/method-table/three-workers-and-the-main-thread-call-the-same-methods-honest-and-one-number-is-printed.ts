// The honest twin of the programs with Workers: four threads call the methods of one family at the same time and nobody changes anything. One number is printed.
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

function work(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += total(meters);
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

if (isMainThread) {
  const answers: Promise<number>[] = [];
  for (const rounds of [10000, 20000, 30000]) {
    const worker = new Worker(new URL(import.meta.url), { workerData: rounds });
    answers.push(new Promise(resolve => worker.once("message", resolve)));
  }
  note(work(40000));
  for (const answer of answers) note(await answer);
  note(work(1));
  console.log(checksum);
} else {
  parentPort?.postMessage(work(workerData));
}
