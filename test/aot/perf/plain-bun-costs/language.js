let sum = 0;
function* count(n) { for (let i = 0; i < n; i++) yield i; }
for (let r = 0; r < 30; r++) for (const v of count(20000)) sum += v & 1;
async function* slowly(n) { for (let i = 0; i < n; i++) yield i; }
for await (const v of slowly(150000)) sum += v & 1;
const proxy = new Proxy({ a: 1 }, { get: (t, k) => (k in t ? t[k] : 2), has: () => true, set: (t, k, v) => ((t[k] = v), true) });
for (let i = 0; i < 100000; i++) { sum += proxy.a + proxy.b; proxy.c = i; sum += "z" in proxy ? 1 : 0; }
class A { #p = 1; static s = 2; get p() { return this.#p; } set p(v) { this.#p = v; } static #q() { return 3; } static q() { return A.#q(); } has(o) { return #p in o; } }
class B extends A { constructor() { super(); this.x = super.p; } get p() { return super.p + 1; } set p(v) { super.p = v; } }
for (let i = 0; i < 75000; i++) { const b = new B(); b.p = i & 3; sum += b.p + A.q() + (b.has(b) ? 1 : 0); }
for (let i = 0; i < 75000; i++) { const [a, , b = 5, ...rest] = [i, 2, undefined, 4, 5]; const { x, y: { z = 3 } = {}, ...others } = { x: 1, w: 2, v: 3 }; sum += a + b + rest.length + x + z + Object.keys(others).length; }
const tag = (s, ...v) => s.raw.length + v.length;
for (let i = 0; i < 100000; i++) sum += tag`a${i}b${i}c` + (`${i}:${i + 1}`).length;
let big = 1n; for (let i = 1; i < 750; i++) big = (big * BigInt(i)) % 1000000007n + (big >> 3n); sum += Number(big % 1000n);
for (let i = 0; i < 50000; i++) sum += Number(BigInt(i) * 3n + 1n) & 1;
for (let i = 0; i < 75000; i++) { try { if (i % 3 === 0) throw i; sum++; } catch (e) { sum += e & 1; } finally { sum++; } }
for (let i = 0; i < 1000; i++) sum += new Function("a", "b", "return a + b + " + i)(1, 2) & 1;
for (let i = 0; i < 1000; i++) sum += eval("(function () { var q = " + i + "; return q * 2; })()") & 1;
function args() { return arguments.length + Array.prototype.slice.call(arguments, 1).length; }
for (let i = 0; i < 100000; i++) sum += args(1, 2, 3) + args(...[1, 2]) + Math.max(...[i, 2, 3]) % 2;
const o = {}; for (let i = 0; i < 60; i++) o["k" + i] = i;
for (let i = 0; i < 5000; i++) { for (const k in o) sum += o[k] & 1; sum += Object.entries(o).length + Object.values(o).length; }
for (let i = 0; i < 50000; i++) { const f = Object.freeze({ a: i }); const d = Object.defineProperty({}, "x", { get: () => i, enumerable: true }); sum += (Object.isFrozen(f) ? 1 : 0) + (d.x & 1) + Object.getOwnPropertyNames(d).length + (Reflect.has(f, "a") ? 1 : 0) + Reflect.ownKeys(f).length; }
for (let i = 0; i < 50000; i++) { const s = Symbol("s"); const h = { [s]: 1, [Symbol.toPrimitive]: () => 2 }; sum += h[s] + +h; }
const weak = new WeakMap(), refs = []; for (let i = 0; i < 50000; i++) { const k = {}; weak.set(k, i); if (i % 100 === 0) refs.push(new WeakRef(k)); sum += weak.get(k) & 1; }
for (let i = 0; i < 25000; i++) { const d = new Date(2026, i % 12, 1 + (i % 28)); sum += d.getDay() + d.toISOString().length + Date.parse("2026-01-0" + (1 + (i % 9))) % 2; }
const view = new DataView(new ArrayBuffer(64)); for (let i = 0; i < 250000; i++) { view.setFloat64(8, i, true); view.setInt16(2, i); sum += view.getFloat64(8, true) & 1; }
const shared = new Int32Array(new SharedArrayBuffer(16)); for (let i = 0; i < 250000; i++) sum += Atomics.add(shared, 0, 1) & 1;
const sorted = Array.from({ length: 100000 }, (_, i) => (i * 2654435761) % 100003); sorted.sort((p, q) => p - q); sum += sorted[500];
sum += new Float64Array(sorted).sort()[500] + sorted.toSorted().length + sorted.flatMap(v => [v, v]).length + sorted.findLast(v => v < 50) + Object.groupBy(sorted, v => v % 3)[1].length;
label: for (let i = 0; i < 500; i++) for (let k = 0; k < 500; k++) { if (k > i) continue label; if (k === 1000) break label; sum++; }
for (let i = 0; i < 75000; i++) sum += (o?.k1 ?? 0) + (o.none?.x ?? 1) + (i ** 2 % 3);
console.log("language", sum);
