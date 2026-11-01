// promise.then(f), promise.then(undefined, f) and promise.catch(f) on promises in every state, among other reactions, and who runs when.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
function show(value: unknown): string {
  if (value instanceof Error) return value.constructor.name + ": " + value.message;
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const unhandled: string[] = [];
process.on("unhandledRejection", reason => { unhandled.push(show(reason)); });
async function turns(count: number) { for (let i = 0; i < count; i++) await null; }

{
  log("== pending, then settled");
  const a = deferred<number>(), b = deferred<number>(), c = deferred<number>(), d = deferred<number>();
  const fromA = a.promise.then(value => { log("a fulfilled " + value); return value + 1; });
  const fromB = b.promise.catch(reason => { log("b rejected " + show(reason)); return -1; });
  const fromC = c.promise.then(undefined, reason => { log("c rejected " + show(reason)); return -2; });
  const fromD = d.promise.then(value => { log("d fulfilled " + value); return value; });
  log(String(fromA instanceof Promise) + " " + String(fromA !== a.promise) + " " + String(Object.getPrototypeOf(fromB) === Promise.prototype));
  d.reject(new Error("d fails")); c.reject("c fails"); b.reject(new Error("b fails")); a.resolve(1);
  log("settled");
  for (const result of await Promise.allSettled([fromA, fromB, fromC, fromD])) log(show(result.status === "fulfilled" ? result.value : result.reason));
}
{
  log("== the handler that does not fit is passed by");
  const a = deferred<number>(), b = deferred<number>();
  const fromA = a.promise.catch(() => { log("never"); return 0; });
  const fromB = b.promise.then(() => { log("never"); return 0; });
  fromA.then(value => log("through " + value));
  fromB.catch(reason => log("through " + show(reason)));
  a.resolve(5); b.reject("no");
  await turns(4);
}
{
  log("== already settled");
  Promise.resolve(1).then(value => log("resolved " + value));
  Promise.reject(new Error("gone")).catch(reason => log("rejected " + show(reason)));
  Promise.reject("gone too").then(undefined, reason => log("rejected " + show(reason)));
  Promise.resolve(2).catch(() => log("never")).then(value => log("passed on " + value));
  queueMicrotask(() => log("a job between"));
  Promise.resolve(3).then(value => log("resolved " + value));
  await turns(4);
}
{
  log("== several reactions on one promise");
  const a = deferred<string>();
  a.promise.then(value => log("first " + value));
  a.promise.then(value => log("second " + value));
  a.promise.catch(() => log("never"));
  a.promise.then(value => log("fourth " + value), () => log("never"));
  (async () => { log("awaited " + (await a.promise)); })();
  a.promise.then(value => log("sixth " + value));
  a.resolve("x");
  await turns(4);
  const b = deferred<string>();
  (async () => { log("awaited first " + (await b.promise)); })();
  b.promise.then(value => log("then second " + value));
  b.resolve("y");
  await turns(4);
}
{
  log("== what a handler returns or throws");
  const a = deferred<number>();
  const chain = a.promise
    .then(value => Promise.resolve(value + 1))
    .then(value => ({ then(resolve: (value: number) => void) { log("then is called"); resolve(value + 1); } }) as unknown as PromiseLike<number>)
    .then(value => { log("got " + show(value)); throw new RangeError("thrown"); })
    .then(() => log("never"))
    .catch(reason => { log("caught " + show(reason)); return deferredLater(); })
    .then(value => log("late " + value));
  function deferredLater() { const later = deferred<string>(); turns(3).then(() => later.resolve("value")); return later.promise; }
  a.resolve(0);
  await chain;
  const self: { promise?: Promise<unknown> } = {};
  const b = deferred<number>();
  self.promise = b.promise.then(() => self.promise);
  b.resolve(0);
  await self.promise.catch(reason => log("itself: " + (reason as Error).constructor.name));
}
{
  log("== other things in the place of a handler");
  const handlers: unknown[] = [undefined, null, 5, "text", {}, Symbol.iterator];
  for (const other of handlers) {
    await Promise.resolve(1).then(value => { log("with " + typeof other + ": " + value); return value; }, other as never);
    await Promise.reject(2).then(other as never, reason => log("with " + typeof other + ": " + reason));
    await Promise.resolve(3).then(other as never).then(value => log("only " + typeof other + ": " + value));
  }
}
{
  log("== a class below Promise");
  class Tracked<T> extends Promise<T> { tag = "tracked"; }
  const a = Tracked.resolve(1).then(value => value + 1);
  log(String(a instanceof Tracked) + " " + (a as Tracked<number>).tag + " " + (await a));
  const b = new Tracked<number>((_, reject) => reject(new Error("tracked fails"))).catch(reason => show(reason));
  log(String(b instanceof Tracked) + " " + (await b));
}
{
  log("== each handler under the store of its then");
  const storage = new AsyncLocalStorage<string>();
  const a = deferred<number>(), b = deferred<number>();
  storage.run("one", () => a.promise.then(() => log("a under " + storage.getStore())));
  storage.run("two", () => b.promise.catch(() => log("b under " + storage.getStore())));
  a.promise.then(() => log("a under " + storage.getStore()));
  storage.run("three", () => { a.resolve(1); b.reject(2); });
  await turns(4);
  storage.run("four", () => Promise.resolve().then(() => log("settled under " + storage.getStore())));
  await turns(2);
}
{
  log("== who counts as handled");
  const a = deferred<number>(), b = deferred<number>(), c = deferred<number>();
  a.promise.then(() => log("never"));
  b.promise.catch(reason => log("b handled " + show(reason)));
  c.promise.then(() => log("never")).catch(reason => log("c handled behind " + show(reason)));
  a.reject(new Error("nobody takes a")); b.reject(new Error("b")); c.reject(new Error("c"));
  await new Promise(resolve => setTimeout(resolve, 5));
  log("unhandled: " + unhandled.join(" | "));
}
{
  log("== many");
  let sum = 0;
  const all: Promise<unknown>[] = [];
  for (let i = 0; i < 3000; i++) {
    const one = deferred<number>();
    all.push(i % 3 ? one.promise.then(value => { sum += value; }) : one.promise.catch(reason => { sum -= reason as number; }));
    if (i % 3) one.resolve(i); else one.reject(i);
  }
  await Promise.all(all);
  log("sum " + sum);
}
console.log(lines.join("\n"));
