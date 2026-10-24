// Through a proxy without traps.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class A { ga = { qc: 1 }; gb = { qc: 2 }; gc = { qc: 3 }; gd = { qc: 4 }; ge = { qc: 5 }; }
function all(o) { return [attempt(() => o.ga.qc), attempt(() => o.gb.qc), attempt(() => o.gc.qc), attempt(() => o.gd.qc), attempt(() => o.ge.qc)].join(); }
const a = new A(), p = new Proxy(a, {});
delete p.ga;
Object.defineProperty(p, "gb", { get() { return undefined; }, configurable: true });
p.gc = 5;
Reflect.defineProperty(p, "gd", { value: "text" });
Reflect.set(Object.create(p), "ge", null, p);
console.log(all(a), Object.keys(a).join());
const b = new A(), q = new Proxy(b, {});
Object.freeze(q);
console.log(attempt(() => { "use strict"; b.ga = { qc: 9 }; return b.ga.qc; }), Object.isFrozen(b));
const c = new A(), s = new Proxy(c, {});
Object.setPrototypeOf(s, { get gz() { return "from above"; } });
console.log(c.gz, c instanceof A);
const d = new A(), { proxy, revoke } = Proxy.revocable(d, {});
Object.assign(proxy, { ga: 1, gb: "two" }); revoke();
console.log(all(d));
console.log(all(new A()));
