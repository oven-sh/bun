// `for await` and `yield*` in async generators over values that are only sync iterable: generators as made and generators whose protocol was changed, containers, iterators written by hand; what is awaited, in which order, and what is closed.
const log = [];
const define = (object, key, value) => Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
const say = (...parts) => log.push(parts.map(part => typeof part === "string" ? part : JSON.stringify(part)).join(" "));
function* count(n) { try { for (let i = 0; i < n; i++) yield i; return "returned"; } finally { say("count closed"); } }
function* promises() { yield Promise.resolve("a"); yield new Promise(resolve => setTimeout(() => resolve("b"), 1)); yield "c"; }
function* rejects() { try { yield 1; yield Promise.reject(new RangeError("rejected")); yield 3; } finally { say("rejects closed"); } }
function* throws() { yield 1; throw new TypeError("thrown"); }
async function collect(name, iterable, limit = Infinity) {
  const seen = [];
  try { for await (const value of iterable) { seen.push(value); if (seen.length >= limit) break; } } catch (e) { seen.push(e instanceof RangeError || e.message === "thrown" ? e.name + ": " + e.message : e.name); }
  say(name, seen);
}
async function* delegate(iterable) { const result = yield* iterable; say("yield* gave", result ?? "undefined"); }
function* ownNext() { yield "original"; }
const handWritten = { [Symbol.iterator]() { let i = 0; return { next() { say("next called"); return { done: i >= 2, value: i++ }; }, return() { say("return called"); return {}; } }; } };
class Range { constructor(n) { this.n = n; } *[Symbol.iterator]() { for (let i = 0; i < this.n; i++) yield i * 10; } }
async function main() {
  await collect("count", count(3));
  await collect("count, left early", count(5), 2);
  await collect("promises", promises());
  await collect("rejects", rejects());
  await collect("throws", throws());
  await collect("array", [1, Promise.resolve(2), 3]);
  await collect("set", new Set(["x", "y"]));
  await collect("map", new Map([["k", 1]]));
  await collect("string", "hé𝒳");
  await collect("array iterator", [7, 8].values());
  await collect("entries", ["p"].entries());
  await collect("hand written", handWritten);
  await collect("hand written, left early", handWritten, 1);
  await collect("a class with a generator method", new Range(3));
  const own = define(ownNext(), "next", function () { return { done: this.used, value: (this.used = true, "own next") }; });
  await collect("own next", own);
  const ownAsync = define(ownNext(), Symbol.asyncIterator, function () { return delegate(["own async iterator"]); });
  await collect("own Symbol.asyncIterator", ownAsync);
  const ownSync = define(ownNext(), Symbol.iterator, function () { return count(1); });
  await collect("own Symbol.iterator", ownSync);
  await collect("own Symbol.asyncIterator that is null", define(ownNext(), Symbol.asyncIterator, null));
  await collect("own Symbol.asyncIterator that is undefined", define(ownNext(), Symbol.asyncIterator, undefined));
  await collect("another own property", define(ownNext(), "other", 1));
  const inherits = count(2); Object.setPrototypeOf(inherits, { __proto__: Object.getPrototypeOf(inherits), next() { return { done: true, value: "never seen" }; } });
  await collect("a next in between", inherits);
  const inheritsAsync = count(2); Object.setPrototypeOf(inheritsAsync, { __proto__: Object.getPrototypeOf(inheritsAsync), [Symbol.asyncIterator]() { return delegate(["async in between"]); } });
  await collect("a Symbol.asyncIterator in between", inheritsAsync);
  const moved = count(2); Object.setPrototypeOf(moved, { __proto__: Object.getPrototypeOf(moved), [Symbol.iterator]() { return ["moved"].values(); } });
  await collect("setPrototypeOf", moved);
  const bare = count(2); Object.setPrototypeOf(bare, null);
  await collect("no prototype", bare);
  const started = count(3); started.next();
  await collect("already started", started);
  const finished = count(0); finished.next();
  await collect("already finished", finished);
  await collect("yield* a generator", delegate(count(2)));
  await collect("yield* promises", delegate(promises()));
  await collect("yield* rejects", delegate(rejects()));
  await collect("yield* left early", delegate(count(4)), 1);
  for (const bad of [undefined, null, 5, {}, { [Symbol.iterator]: 1 }, { [Symbol.asyncIterator]: 1 }, { [Symbol.iterator]() { return 1; } }]) await collect("not iterable", bad);
  const order = [];
  const ticks = (async () => { for (let i = 0; i < 12; i++) { order.push("tick " + i); await undefined; } })();
  const loop = (async () => { for await (const value of count(3)) order.push("value " + value); order.push("loop done"); })();
  await Promise.all([ticks, loop]);
  say("order", order);
  let sum = 0;
  for (let i = 0; i < 20000; i++) for await (const value of count(2)) sum += value + i;
  log.splice(log.lastIndexOf("count closed") - 19999, 19999);
  say("sum", sum);
}
main().then(() => console.log(log.join("\n")), e => console.log("main rejected", e));
