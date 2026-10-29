// The handlers of promise reactions and the functions given to queueMicrotask: how they are called, what becomes of what they return and throw, and their place among the jobs of coroutines.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
function show(value: unknown): string {
  if (value instanceof Error) return value.constructor.name + ": " + value.message;
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
process.on("uncaughtException", error => log("uncaught " + show(error)));
process.on("unhandledRejection", reason => log("unhandled " + show(reason)));
async function turns(count: number) { for (let i = 0; i < count; i++) await null; }
const macrotask = () => new Promise<void>(resolve => setTimeout(resolve, 1));

async function* numbers(name: string, count: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) { await null; log(name + " yields " + i); yield i; }
}
async function consume(name: string, count: number) {
  for await (const value of numbers(name, count)) log(name + " sees " + value);
}
async function waits(name: string, count: number) {
  for (let i = 0; i < count; i++) { await null; log(name + " behind await " + i); }
}

log("== in their places");
{
  let chain: Promise<number> = Promise.resolve(0);
  for (let i = 0; i < 6; i++) chain = chain.then(value => { log("link " + value); return value + 1; });
  let count = 0;
  const again = () => { log("queued " + count); if (++count < 6) queueMicrotask(again); };
  queueMicrotask(again);
  await Promise.all([chain, consume("a", 2), waits("b", 5), consume("c", 1)]);
}

log("== how they are called");
{
  function counts(this: unknown, ...all: unknown[]) { log("this " + typeof this + ", " + all.length + " arguments: " + all.map(show).join()); }
  function three(a?: unknown, b?: unknown, c?: unknown) { log("three: " + show(a) + " " + show(b) + " " + show(c) + " of " + arguments.length); }
  await Promise.resolve("value").then(counts);
  await Promise.reject("reason").catch(counts);
  await Promise.resolve("value").then(three);
  queueMicrotask(counts);
  queueMicrotask(three);
  await turns(2);
  const list: unknown[] = [];
  await Promise.resolve(1).then(list.push.bind(list));
  await Promise.resolve(2).then(Array.prototype.push.bind(list, "bound"));
  log("pushed " + show(list));
  await Promise.resolve([3, 1, 2]).then(Math.max.apply.bind(Math.max, null)).then(value => log("max " + value));
  await Promise.resolve("5").then(Number).then(value => log(typeof value + " " + value));
  await Promise.resolve(4).then(new Proxy((value: number) => value * 2, { apply(target, self, all) { log("trap with " + all.length); return Reflect.apply(target, self, all); } })).then(value => log("through the proxy " + value));
  class Holder { static tag = "holder"; static read(this: unknown, value: number) { return String(this) + " " + value; } }
  await Promise.resolve(6).then(Holder.read).then(value => log(value));
  await Promise.resolve(7).then(async value => { await null; return value + 1; }).then(value => log("from an async function " + value));
  await Promise.resolve(8).then(function* (value) { yield value; }).then(value => log("a generator " + show([...value])));
  queueMicrotask(async () => { await null; log("an async function was queued"); });
  queueMicrotask(log.bind(null, "a bound function was queued"));
  await turns(3);
}

log("== what they throw");
{
  await Promise.resolve(1).then(() => { throw new TypeError("from a handler"); }).catch(reason => log("caught " + show(reason)));
  await Promise.reject(2).catch(() => { throw new RangeError("from a catch"); }).then(() => log("never"), reason => log("caught " + show(reason)));
  Promise.resolve(3).then(() => { throw new Error("nobody catches this"); });
  Promise.resolve(4).then(() => log("the next handler runs"));
  queueMicrotask(() => { log("throws next"); throw new Error("from a queued function"); });
  queueMicrotask(() => log("the next queued function runs"));
  waits("d", 2);
  consume("e", 1);
  queueMicrotask(() => { throw "not an error"; });
  Promise.resolve(5).then(() => log("and the handler behind it"));
  await macrotask();
  await macrotask();
}

log("== what they return");
{
  const pending: ((value: string) => void)[] = [];
  const outcomes = [
    Promise.resolve(0).then(() => undefined),
    Promise.resolve(0).then(() => null),
    Promise.resolve(0).then(() => ({ plain: true })),
    Promise.resolve(0).then(() => [1, 2]),
    Promise.resolve(0).then(() => Promise.resolve("a promise")),
    Promise.resolve(0).then(() => new Promise<string>(resolve => pending.push(resolve))),
    Promise.resolve(0).then(() => Promise.reject(new Error("a rejected promise"))),
    Promise.resolve(0).then(() => ({ then(resolve: (value: string) => void) { log("then of a thenable"); resolve("a thenable"); } }) as unknown as string),
    Promise.resolve(0).then(() => ({ get then() { log("then is read"); return undefined; } })),
    Promise.resolve(0).then(() => ({ get then(): never { throw new Error("then throws"); } })),
    Promise.resolve(0).then(() => () => "a function"),
    Promise.resolve(0).then(() => Symbol.for("a symbol")),
  ];
  await turns(3);
  pending[0]("settled later");
  for (const result of await Promise.allSettled(outcomes)) log(result.status + " " + (typeof (result as any).value === "function" ? "function" : typeof (result as any).value === "symbol" ? "symbol" : show(result.status === "fulfilled" ? result.value : result.reason)));
}

log("== what waits for the derived promise");
{
  const base = Promise.resolve("x");
  const derived = base.then(value => value + "y");
  derived.then(value => log("first " + value));
  derived.then(value => log("second " + value));
  (async () => log("awaited " + (await derived)))();
  const other = base.then(value => value + "z");
  (async () => log("awaited alone " + (await other)))();
  const unused = base.then(value => value + "w");
  await turns(4);
  log("unused " + (await unused));
  const raced = await Promise.race([base.then(() => "left"), base.then(() => "right")]);
  log("raced " + raced + ", all " + show(await Promise.all([base.then(() => 1), base.then(() => 2)])));
}

log("== ticks, timers and jobs");
{
  process.nextTick(() => { log("tick 1"); Promise.resolve().then(() => log("job from tick 1")); });
  Promise.resolve().then(() => { log("job 1"); process.nextTick(() => log("tick from job 1")); queueMicrotask(() => log("job from job 1")); });
  queueMicrotask(() => { log("job 2"); process.nextTick(() => log("tick from job 2")); });
  setTimeout(() => log("timer"), 0);
  waits("f", 2);
  await macrotask();
  await macrotask();
}

log("== stores");
{
  const storage = new AsyncLocalStorage<string>();
  const base = Promise.resolve();
  storage.run("one", () => { base.then(() => log("handler under " + storage.getStore())); queueMicrotask(() => log("queued under " + storage.getStore())); });
  base.then(() => log("handler under " + storage.getStore()));
  queueMicrotask(() => log("queued under " + storage.getStore()));
  storage.run("two", () => { base.then(() => log("handler under " + storage.getStore())).then(() => log("its link under " + storage.getStore())); waits("g", 1).then(() => log("behind a coroutine under " + storage.getStore())); });
  base.then(() => log("handler under " + storage.getStore()));
  await turns(5);
}

log("== traces");
{
  async function unrelatedCoroutine() { await null; await null; }
  function namedHandler() { return String(new Error("here").stack); }
  unrelatedCoroutine();
  const trace = await Promise.resolve().then(namedHandler);
  log("names the handler " + trace.includes("namedHandler") + ", names the coroutine " + trace.includes("unrelatedCoroutine"));
  let queuedTrace = "";
  unrelatedCoroutine();
  queueMicrotask(function namedFunction() { queuedTrace = String(new Error("here").stack); });
  await turns(3);
  log("names the function " + queuedTrace.includes("namedFunction") + ", names the coroutine " + queuedTrace.includes("unrelatedCoroutine"));
}

log("== long");
{
  let chain: Promise<number> = Promise.resolve(0);
  for (let i = 0; i < 50000; i++) chain = chain.then(value => value + 1);
  let count = 0;
  await new Promise<void>(resolve => { const next = () => { if (++count < 50000) queueMicrotask(next); else resolve(); }; queueMicrotask(next); });
  log("chain " + (await chain) + ", queued " + count);
}
console.log(lines.join("\n"));
