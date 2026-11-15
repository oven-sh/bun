const out = [];
const show = v => (v instanceof Error ? v.name + ":" + v.message : Array.isArray(v) ? v.constructor.name + "[" + Array.from(v, show) + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{" + Object.keys(v) + "}" : String(v));
const log = (...values) => out.push(values.map(show).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error; } };
let closed = 0;
function* range(a, b) { for (let k = a; k < b; k++) yield k; }
function* guarded(n) { try { for (let k = 0; k < n; k++) yield k; } finally { closed++; } }
function* throws(n) { yield 1; if (n) throw new RangeError("later"); yield 2; }
function* answers() { yield undefined; yield null; return "answer"; }
function* delegates() { yield* range(0, 2); yield* [7, , 9]; return yield* guarded(2); }
const object = { *[Symbol.iterator]() { yield 1; yield "two"; yield -0; } };
class Bag { constructor(values) { this.values = values; } *[Symbol.iterator]() { for (const v of this.values) yield v; } }
class Steps { constructor(n) { this.n = n; this.at = 0; } [Symbol.iterator]() { return this; } next() { return this.at < this.n ? { value: this.at++, done: false } : { value: 99, done: true }; } return() { closed += 100; return {}; } }
class List extends Array { }
class Odd { constructor(...args) { this.args = args; } }
for (let round = 0; round < 3; round++) {
  log(Array.from(range(0, 4)), Array.from(range(0, 4), v => v * 2), Array.from(range(2, 4), function (v, k) { return this.base + v + k; }, { base: 10 }));
  log(Array.from(guarded(3)), closed, attempt(() => Array.from(guarded(3), v => { if (v === 1) throw new Error("mapper"); return v; })), closed);
  log(attempt(() => Array.from(throws(1))), Array.from(throws(0)), Array.from(answers()), Array.from(delegates()), closed);
  log(Array.from(object), Array.from(new Bag([3, 1])), Array.from(new Steps(3)), attempt(() => Array.from(new Steps(3), () => { throw new Error("own"); })), closed);
  log(List.from(range(0, 3)), List.from(range(0, 2), v => -v), Array.from.call(Odd, range(0, 2)), Array.from.call(undefined, range(0, 2)));
  log(Array.from([1, , 3]), Array.from(new Set([1, 2])), Array.from(new Map([["a", 1]])), Array.from("a\u{1F600}"), Array.from({ length: 2, 0: "x" }), Array.from({ length: 2 }, (v, k) => k), Array.from(new Uint8Array([1, 2]), v => v + 1));
  const started = range(0, 5); started.next(); log(Array.from(started), Array.from(started));
  const own = range(0, 3); own.next = () => ({ value: "own", done: closed++ % 3 === 2 }); log(Array.from(own).length > -1);
  const other = range(0, 3); const wrapped = { [Symbol.iterator]: () => ({ next: other.next }) }; log(attempt(() => Array.from(wrapped)));
  const borrowed = { [Symbol.iterator]: () => Object.assign(Object.create(range(0, 2)), {}) }; log(attempt(() => Array.from(borrowed)));
  function* itself() { yield 1; yield attempt(() => Array.from(me)); } const me = itself(); log(Array.from(me));
  log(attempt(() => Array.from(null)), attempt(() => Array.from(undefined)), attempt(() => Array.from({ [Symbol.iterator]: 5 })), attempt(() => Array.from([1], 5)), attempt(() => Array.from({ [Symbol.iterator]: () => 5 })));
  const proxied = new Proxy(range(0, 2), {}); log(attempt(() => Array.from(proxied)));
}
log(Array.from.length, Array.from.name, Array.fromAsync.length);
const later = await Array.fromAsync(range(0, 3), async v => v + 1);
log(later, await Array.fromAsync({ length: 2, 0: Promise.resolve(5), 1: 6 }), await Array.fromAsync((async function* () { yield 1; yield 2; })()));
log(await Array.fromAsync(null).catch(error => error.name), await Array.fromAsync(range(0, 2), 5).catch(show));
console.log(out.join("\n"));
