// new Proxy() of objects that are no functions makes its cell without the run time.
// COUNTER: operationAOTPrepareProxyAllocation >= 1
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const handler = { get: (t, k, r) => (k === "n" ? t.n + 1 : Reflect.get(t, k)) };
const make = (target, traps) => new Proxy(target, traps);
let sum = 0;
for (let i = 0; i < 20000; i++) sum += make({ n: i }, handler).n + make([i], {}).length;
console.log(sum);
class Holder { constructor(n) { this.n = n; } }
const targets = [{ n: 1 }, [1, 2], new Holder(3), Object.create(null), Object.freeze({ n: 4 }), function () { return 5; }, class { constructor() { this.n = 6; } }, () => 7, new Map([[1, 2]]), new Date(0), /x/g, new Proxy({ n: 8 }, {}), new Proxy(() => 9, {}), new Uint8Array(2), Math, JSON, globalThis, Symbol("s"), "text", 5, null, undefined, true, 5n];
for (let round = 0; round < 3; round++) for (const target of targets) {
  console.log(attempt(() => typeof make(target, handler)), attempt(() => Array.isArray(make(target, {}))), attempt(() => make(target, {})()), attempt(() => typeof new (make(target, {}))()), attempt(() => Object.keys(make(target, {})).length < 1e6), attempt(() => Object.getPrototypeOf(make(target, {})) === Object.getPrototypeOf(target)));
}
for (const traps of [{}, [], () => 1, new Proxy({}, {}), null, undefined, 1, "t", Symbol("t")]) console.log(attempt(() => make({ n: 1 }, traps).n), attempt(() => Object.prototype.toString.call(make([], traps))));
console.log(attempt(() => Proxy({}, {})), attempt(() => new Proxy({})), attempt(() => new Proxy()), attempt(() => new Proxy({ n: 2 }, {}, 3).n));
console.log(attempt(() => Reflect.construct(Proxy, [{ n: 3 }, {}], Holder).n), attempt(() => Reflect.construct(Proxy, [{ n: 3 }, {}], Holder) instanceof Holder), attempt(() => { class P extends Proxy {} return new P({}, {}); }));
// Traps that are looked up at another time, revocation, and many that stay.
const late = {}, p = make({ n: 5 }, late);
console.log(p.n, "n" in p); late.get = () => "late"; late.has = () => false; console.log(p.n, "n" in p); delete late.get; console.log(p.n);
const kept = []; for (let i = 0; i < 30000; i++) { const q = make({ n: i }, i & 1 ? handler : {}); if (i % 100 === 0) kept.push(q); }
console.log(kept.reduce((a, q) => a + q.n, 0), kept.length);
const { proxy, revoke } = Proxy.revocable({ n: 1 }, handler); console.log(proxy.n); revoke(); console.log(attempt(() => proxy.n), attempt(() => make(proxy, {}).n));
