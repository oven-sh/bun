// Data redefinitions with another kind of value; accessors over fields; fields over accessors.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class A { ga = { qd: 1 }; gb = 1.5; gc = "text"; gd = [1]; }
function all(o) { return [attempt(() => o.ga.qd), attempt(() => o.gb + 1), attempt(() => o.gc.length), attempt(() => o.gd.length)].join(); }
const a = new A();
Object.defineProperty(a, "ga", { value: 5 }); Object.defineProperty(a, "gb", { value: "s" }); Object.defineProperty(a, "gc", { value: undefined }); Object.defineProperty(a, "gd", { value: { length: "L" } });
console.log(all(a));
const b = new A();
Object.defineProperties(b, { ga: { value: null }, gb: { get() { return { valueOf() { return 41; } }; } }, gc: { value: 12 }, gd: { value: "abc" } });
console.log(all(b));
const c = new A();
for (const [k, v] of Object.entries({ ga: true, gb: 2n, gc: Symbol.iterator, gd: () => 1 })) c[k] = v;
console.log(all(c));
const d = Object.assign(new A(), JSON.parse('{"ga":[1],"gb":{"x":1},"gc":3,"gd":"q"}'));
console.log(all(d));
const e = new A(); Object.entries(e).forEach(([k]) => Reflect.set(e, k, k));
console.log(all(e));
const f = new A(); ({ ga: f.gb, gb: f.ga, gc: f.gd, gd: f.gc } = f);
console.log(all(f));
const g = new A(); [g.ga, g.gb, g.gc, g.gd] = [1, "2", 3, 4];
console.log(all(g));
const h = new A(); for (h.ga of [7]); for (h.gc in { k: 1 }); for (h.gb in { z: 1 });
console.log(all(h));
console.log(all(new A()));
