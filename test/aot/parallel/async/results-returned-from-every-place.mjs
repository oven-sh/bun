// Each way in which an async function returns: from its first run, after awaits, with and without values held across them, with values that are thenables, promises or neither, inside handlers, and while others wait.
const lines = [];
const note = (...values) => lines.push(values.map(value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value))).join(" "));
const later = value => new Promise(resolve => queueMicrotask(() => resolve(value)));

async function nothing() {}
async function undefinedAfter(wait) { await wait; }
async function number(x) { return x + 0.5; }
async function small(x) { if (x) { await null; return x | 0; } return -1; }
async function text(x) { const before = `<${x}`; await later(1); return before + ">"; }
async function object(x) { const held = { x }; if (x > 2) await later(x); held.y = x * 2; return held; }
async function list(...rest) { await null; return rest.map(x => x * 2); }
async function withArguments() { await null; return arguments.length; }
async function defaults(a = nothing(), b = later(7)) { await a; return (await b) + 1; }
async function nullish(x) { await x; return x > 1 ? null : undefined; }
async function boolean(x) { return x > 1 ? true : await later(false); }
async function bigint(x) { await null; return BigInt(x) * 3n; }
async function held(a, b, c, d, e, f, g) {
  const first = a + b, second = c + d, third = e + f;
  await later(first);
  const fourth = first * g;
  if (fourth > 100) return [first, second, third, fourth];
  await later(second);
  return [third, second, first, fourth, a, b, c, d, e, f, g];
}
async function inHandlers(x) {
  try {
    if (x === 0) return "try";
    await later(x);
    if (x === 1) throw new Error("one");
    return "after";
  } catch (error) {
    if (x === 1) return "caught " + error.message;
    throw error;
  } finally {
    note("finally", x);
    if (x === 3) return "finally";
  }
}
async function fromLoop(values) {
  let sum = 0;
  for (const value of values) {
    sum += await value;
    if (sum > 10) return sum;
  }
  return -sum;
}
async function thenable(kind) {
  if (kind > 3) await null;
  switch (kind & 3) {
    case 0: return { then(resolve) { resolve("own then"); } };
    case 1: return { get then() { note("getter", kind); return undefined; }, kind };
    case 2: return { get then() { throw new Error("then " + kind); } };
    default: return { get then() { return (resolve, reject) => reject(new Error("rejected " + kind)); } };
  }
}
async function promised(kind) {
  if (kind > 2) await later(0);
  return kind % 3 === 0 ? later("promise") : kind % 3 === 1 ? Promise.reject(new Error("no " + kind)) : number(kind);
}
class Account {
  #balance = 10;
  async take(amount) { await null; this.#balance -= amount; return this.#balance; }
  static async open() { return new Account(); }
  both = async amount => { const left = await this.take(amount); return [left, this instanceof Account]; };
}
async function waiters(depth) { return depth ? (await waiters(depth - 1)) + 1 : later(0); }
async function settled(x) { return x; }
async function adds(n) { let sum = 0; for (let i = 0; i < n; ++i) sum += await settled(i); return sum; }
async function keepsOld(store, i) { store.last = { i }; await null; return store.last; }
async function deep(n) { return n ? deep(n - 1) : { then(resolve) { resolve(settled("deep")); } }; }
async function collects() { await later(1); return { get then() { for (let i = 0; i < 2000; ++i) Array.from({ length: 10 }, () => ({ i })); return undefined; }, done: true }; }

async function outcome(name, promise) {
  try {
    note(name, promise instanceof Promise, await promise);
  } catch (error) {
    note(name, "rejected", error.message);
  }
}

await outcome("nothing", nothing());
await outcome("undefinedAfter", undefinedAfter(later(1)));
for (let x = 0; x < 4; ++x) {
  await outcome("number", number(x));
  await outcome("small", small(x));
  await outcome("text", text(x));
  await outcome("object", object(x));
  await outcome("nullish", nullish(x));
  await outcome("boolean", boolean(x));
  await outcome("bigint", bigint(x));
  await outcome("inHandlers", inHandlers(x));
  await outcome("held", held(x, 1, 2, 3, 4, 5, 60));
}
await outcome("list", list(1, 2, 3, 4, 5, 6, 7, 8, 9));
await outcome("withArguments", withArguments(1, 2, 3, 4, 5, 6, 7, 8));
await outcome("defaults", defaults());
await outcome("fromLoop", fromLoop([1, later(2), 3, later(6), 100]));
await outcome("fromLoop", fromLoop([1, 2]));
for (let kind = 0; kind < 8; ++kind) await outcome("thenable " + kind, thenable(kind));
for (let kind = 0; kind < 6; ++kind) await outcome("promised " + kind, promised(kind));
const account = await Account.open();
await outcome("take", account.take(3));
await outcome("both", account.both(2));
await outcome("waiters", waiters(50));
await outcome("adds", adds(5000));
await outcome("deep", deep(200));
await outcome("collects", collects());
const store = {};
for (let i = 0; i < 20000; ++i) await keepsOld(store, i);
note("store", store.last);
const order = [];
await Promise.all([1, 2, 3, 4].map(async i => { order.push("in " + i); await later(i); order.push("out " + i); return i; })).then(all => note("all", all, order));
const states = [];
nothing().then(() => states.push("a"));
settled(1).then(() => states.push("b"));
thenable(0).then(() => states.push("c"));
small(1).then(() => states.push("d"));
later(0).then(() => states.push("e"));
for (let i = 0; i < 8; ++i) await null;
note("states", states);
console.log(lines.join("\n"));
