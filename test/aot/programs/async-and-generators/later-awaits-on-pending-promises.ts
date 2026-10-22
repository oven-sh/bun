// From its second suspension on an activation registers itself with what it awaits: every kind of awaited value, in the order of jobs that the language gives
import { AsyncLocalStorage } from "node:async_hooks";

const log: string[] = [];
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function awaitsTwice(name: string, first: Promise<number>, second: Promise<number>): Promise<number> {
  const a = await first;
  log.push(`${name} first ${a}`);
  const b = await second;
  log.push(`${name} second ${b}`);
  return a + b;
}

async function orderAmongReactions() {
  const first = deferred<number>();
  const second = deferred<number>();
  second.promise.then(v => log.push(`then before ${v}`));
  const one = awaitsTwice("one", first.promise, second.promise);
  const two = awaitsTwice("two", first.promise, second.promise);
  first.resolve(1);
  await tick();
  second.promise.then(v => log.push(`then after ${v}`));
  second.resolve(2);
  queueMicrotask(() => log.push("job behind the resolution"));
  log.push(`sums ${await one} ${await two}`);
}

async function onlyWaiter() {
  const first = deferred<number>();
  const second = deferred<number>();
  const sum = awaitsTwice("alone", first.promise, second.promise);
  first.resolve(10);
  await tick();
  second.resolve(20);
  Promise.resolve().then(() => log.push("job queued behind"));
  log.push(`alone ${await sum}`);
}

async function catchesLaterRejection(first: Promise<number>, second: Promise<number>) {
  await first;
  try {
    await second;
    log.push("not reached");
  } catch (error) {
    log.push(`caught ${(error as Error).message}`);
  }
  return "after catch";
}

async function rejections() {
  const first = deferred<number>();
  const second = deferred<number>();
  const result = catchesLaterRejection(first.promise, second.promise);
  first.resolve(0);
  await tick();
  second.reject(new Error("late"));
  log.push(await result);
}

async function resolvedWithPromise() {
  const first = deferred<number>();
  const outer = deferred<number>();
  const inner = deferred<number>();
  const sum = awaitsTwice("chained", first.promise, outer.promise);
  first.resolve(1);
  outer.resolve(inner.promise);
  await tick();
  inner.resolve(41);
  log.push(`chained ${await sum}`);
}

class OwnPromise<T> extends Promise<T> {}
async function otherAwaitedValues(gate: Promise<void>) {
  await gate;
  log.push(`subclass ${await OwnPromise.resolve(5)}`);
  log.push(`thenable ${await { then(resolve: (v: number) => void) { resolve(6); } }}`);
  log.push(`number ${await 7}`);
  log.push(`object ${JSON.stringify(await { plain: 8 })}`);
  log.push(`settled ${await Promise.resolve(9)}`);
  const late = deferred<number>();
  setImmediate(() => late.resolve(10));
  log.push(`pending ${await late.promise}`);
}

async function leaf(gates: Promise<number>[]): Promise<number> {
  let sum = 0;
  for (const gate of gates) sum += await gate;
  return sum;
}
async function middle(gates: Promise<number>[], own: Promise<number>): Promise<number> {
  const before = await own;
  const below = await leaf(gates);
  const again = await leaf(gates);
  return before + below + again;
}
async function top(gates: Promise<number>[], own: Promise<number>): Promise<string> {
  await own;
  try {
    return `top ${await middle(gates, own)}`;
  } catch (error) {
    return `top caught ${(error as Error).message}`;
  }
}

async function chainsOfCalls() {
  for (const fails of [false, true]) {
    const own = deferred<number>();
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const result = top(gates.map(g => g.promise), own.promise);
    own.resolve(100);
    await tick();
    gates[0].resolve(1);
    await tick();
    gates[1].resolve(2);
    await tick();
    if (fails) gates[2].reject(new Error("third gate"));
    else gates[2].resolve(3);
    log.push(await result);
  }
}

async function manyFramesAcrossCollections() {
  const gates = Array.from({ length: 200 }, () => deferred<number>());
  const opened = deferred<number>();
  const sums = gates.map((gate, i) => awaitsTwice(`frame${i}`, opened.promise, gate.promise));
  opened.resolve(1);
  await tick();
  Bun.gc(true);
  gates.forEach((gate, i) => gate.resolve(i));
  Bun.gc(true);
  const total = (await Promise.all(sums)).reduce((a, b) => a + b, 0);
  log.splice(log.findIndex(line => line.startsWith("frame")));
  log.push(`frames ${total}`);
}

const storage = new AsyncLocalStorage<string>();
async function readsStore(name: string, first: Promise<number>, second: Promise<number>) {
  await first;
  log.push(`${name} ${storage.getStore()}`);
  await second;
  log.push(`${name} ${storage.getStore()}`);
  log.push(`${name} ${await leaf([second])} ${storage.getStore()}`);
}
async function contexts() {
  const first = deferred<number>();
  const second = deferred<number>();
  const a = storage.run("a", () => readsStore("in a", first.promise, second.promise));
  const b = storage.run("b", () => readsStore("in b", first.promise, second.promise));
  const none = readsStore("outside", first.promise, second.promise);
  first.resolve(1);
  await tick();
  storage.run("resolver", () => second.resolve(2));
  await Promise.all([a, b, none]);
}

process.on("unhandledRejection", reason => log.push(`unhandled ${(reason as Error).message}`));

await orderAmongReactions();
await onlyWaiter();
await rejections();
await resolvedWithPromise();
await otherAwaitedValues(tick());
await chainsOfCalls();
await manyFramesAcrossCollections();
await contexts();
await onlyWaiter();
await tick();
console.log(log.join("\n"));
