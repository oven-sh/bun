// Promise.all over async calls, promises and plain values, and what happens when a promise is settled by a job: whoever waits for it, a coroutine, a handler or nobody, gets its turn in its place.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
function show(value: unknown): string {
  if (value instanceof Error) return value.constructor.name + ": " + value.message;
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function ticks(name: string, count: number) {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(() => log(name + " tick " + i));
}
async function turns(count: number) { for (let i = 0; i < count; i++) await null; }
async function after<T>(count: number, value: T): Promise<T> { await turns(count); log("ready " + show(value)); return value; }
async function failsAfter(count: number, message: string): Promise<never> { await turns(count); log("fails " + message); throw new Error(message); }

log("== all of async calls");
{
  ticks("a", 8);
  log(show(await Promise.all([after(1, 1), after(3, 2), after(2, 3)])));
  log(show(await Promise.all([after(0, "x")])));
  log(show(await Promise.all([])));
  const [first, second] = await Promise.all([after(2, { a: 1 }), after(1, [1, 2])]);
  log(show(first) + " " + show(second));
}
log("== all of everything");
{
  ticks("b", 8);
  const thenable = { then(resolve: (value: string) => void) { log("then of the thenable"); resolve("thenable"); } };
  const mixed = await Promise.all([1, "two", null, undefined, Promise.resolve(5), after(2, 6), thenable, new Promise(resolve => setTimeout(resolve, 1, "timer")), Promise.resolve().then(() => "handler"), { plain: true }]);
  log(show(mixed) + " " + Array.isArray(mixed) + " " + mixed.length);
}
log("== one fails");
{
  ticks("c", 8);
  for (const make of [
    () => [after(1, 1), failsAfter(2, "second"), after(3, 3)],
    () => [failsAfter(0, "first"), after(1, 2)],
    () => [after(1, 1), after(1, 2), failsAfter(1, "last")],
    () => [failsAfter(1, "one"), failsAfter(1, "other")],
    () => [Promise.reject(new Error("rejected already")), after(1, 1)],
  ]) {
    try { log(show(await Promise.all(make()))); } catch (error) { log("caught " + show(error)); }
    await turns(4);
  }
}
log("== who waits for the promise of all");
{
  const all = Promise.all([after(1, 1), after(2, 2)]);
  all.then(value => log("a handler " + show(value)));
  (async () => log("a coroutine " + show(await all)))();
  all.then(value => log("another handler " + show(value)));
  await turns(6);
  const alone = Promise.all([after(1, 3)]);
  (async () => log("a coroutine alone " + show(await alone)))();
  await turns(5);
  const handled = Promise.all([after(1, 4)]);
  handled.then(value => log("a handler alone " + show(value)));
  await turns(5);
  const unwatched = Promise.all([after(1, 5)]);
  await turns(5);
  log("nobody waited: " + show(await unwatched));
  async function* yieldsAll() { yield await Promise.all([after(1, 6)]); yield Promise.all([after(1, 7)]); }
  for await (const value of yieldsAll()) log("a generator " + show(value));
}
log("== who waits for what a handler settles");
{
  ticks("d", 10);
  log("awaited " + (await Promise.resolve(1).then(value => value + 1)));
  log("awaited behind two " + (await Promise.resolve(1).then(value => value + 1).then(value => value + 1)));
  log("awaited a catch " + (await Promise.reject(1).catch(reason => (reason as number) + 1)));
  async function* inGenerator() { const got = await Promise.resolve("g").then(value => value + "!"); yield got; yield Promise.resolve("h").then(value => value + "!"); }
  for await (const value of inGenerator()) log("in a generator " + value);
  const shared = Promise.resolve("s").then(value => value + "!");
  const waiting = [1, 2, 3].map(async n => log("waiter " + n + " " + (await shared)));
  await Promise.all(waiting);
  let settle!: (value: string) => void;
  const deferred = new Promise<string>(resolve => { settle = resolve; });
  (async () => log("deferred " + (await deferred)))();
  Promise.resolve("by a handler").then(settle);
  await turns(4);
}
log("== under stores");
{
  const storage = new AsyncLocalStorage<string>();
  const here = () => String(storage.getStore());
  const results = await Promise.all([
    storage.run("one", async () => { const value = await Promise.all([after(1, 1), after(2, 2)]); return here() + " " + show(value); }),
    storage.run("two", async () => { const value = await Promise.resolve(3).then(x => { log("handler under " + here()); return x; }); return here() + " " + value; }),
    (async () => { await Promise.all([after(1, 4)]); return here(); })(),
  ]);
  log(show(results) + " behind: " + here());
}
log("== many and large");
{
  const large = await Promise.all(Array.from({ length: 2000 }, (_, i) => (i % 3 ? after2(i) : i)));
  async function after2(i: number) { await null; return i; }
  log("large " + large.length + " " + large.reduce((a, b) => a + b, 0));
  let sum = 0;
  for (let i = 0; i < 3000; i++) { const [a, b] = await Promise.all([after2(i), after2(i + 1)]); sum += a + b; }
  log("many " + sum);
  const objects = await Promise.all(Array.from({ length: 500 }, async (_, i) => { await null; return { i, list: [i, i + 1] }; }));
  log("objects " + objects.reduce((a, b) => a + b.list[1], 0));
}
console.log(lines.filter(line => !line.startsWith("ready ") || lines.length < 400).join("\n"));
