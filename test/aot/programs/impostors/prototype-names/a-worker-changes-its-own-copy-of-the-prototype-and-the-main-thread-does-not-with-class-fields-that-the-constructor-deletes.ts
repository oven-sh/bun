// The main thread and two workers run the same compiled code, each with prototype objects of its own.
// One worker puts the name on its prototype, the main thread and the other worker do not; afterwards the main thread does and asks a third worker. Nobody may see another's change.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Links {
  declare id: number;
  resolved?: number;
  constructor(id: number) {
    delete this.resolved;
    handOver(this);
    this.id = id;
  }
}
function read(links: Links) {
  return links.resolved;
}
function write(links: Links, value: number) {
  links.resolved = value;
}
function exercise(change: boolean) {
  const calls: number[] = [];
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    const links = new Links(i);
    sum += read(links) ?? 1;
    if (i & 1) write(links, 2);
    sum += read(links) ?? 1;
  }
  const old = new Links(1);
  if (change) {
    Object.defineProperty(Object.getPrototypeOf(old), "resolved", {
      get() {
        return 50;
      },
      set(value: number) {
        calls.push(value);
      },
      configurable: true,
    });
  }
  const fresh = new Links(2);
  const seen = `${read(old)} ${read(fresh)}`;
  write(old, 3);
  write(fresh, 4);
  return `${sum} ${seen} ${read(old)} ${read(fresh)} [${Object.keys(old)}] [${calls}]`;
}
function ask(change: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { change } });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}
if (isMainThread) {
  const [changing, quiet] = await Promise.all([ask(true), ask(false)]);
  console.log("a worker that changes:", changing);
  console.log("a worker that does not:", quiet);
  console.log("the main thread, unchanged:", exercise(false));
  console.log("the main thread changes:", exercise(true));
  console.log("a worker started afterwards:", await ask(false));
  console.log("the main thread again:", exercise(false));
} else {
  parentPort!.postMessage(exercise(workerData.change));
}
