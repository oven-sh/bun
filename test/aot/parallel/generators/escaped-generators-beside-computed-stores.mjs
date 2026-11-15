// STATISTIC: GeneratorCallsTestedBeforeLoops >= 5
// Generators of the function escape, and the program stores under computed keys through objects it does not know. A loop whose iteration cannot run such a store asks the function first.
const keys = JSON.parse('["a","b"]');
globalThis.store = (object, key, value) => { object[key] = value; };
globalThis.store(globalThis[keys[0] + "Object"] ??= {}, keys[1], 1);
function* range(from, to) { for (let i = from; i < to; i++) yield i; }
globalThis.sinks = [v => typeof v.next];
console.log(globalThis.sinks.map(f => f(range(0, 2))).join());
const twice = x => x * 2 + 1;
const sum = n => { let s = 0; for (const v of range(0, n)) s += v; return s; };
const odd = n => { const out = []; for (const v of range(0, n)) if (v & 1) out.push(v); return out.join(); };
const helped = n => { let s = 0; for (const v of range(0, n)) s += twice(v); return s; };
const atLeast = (n, least) => { let s = 0; for (const v of range(0, n)) s += Math.max(v, least); return s; };
const digits = n => { let s = 0; for (const v of range(0, n)) s += String(v).length; return s; };
const first = (n, limit) => { for (const v of range(0, n)) if (v * v > limit) return v; return -1; };
globalThis.unknown = v => v + 1;
const unknown = n => { let s = 0; for (const v of range(0, n)) s += globalThis.unknown(v); return s; };
for (let k = 0; k < 3; k++) console.log(sum(10 + k), odd(9), helped(5 + k), atLeast(12, 5), digits(15), first(20, 50 * k), unknown(4));
