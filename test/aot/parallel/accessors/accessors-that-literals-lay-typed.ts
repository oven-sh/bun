// @ts-nocheck is not wanted here: the types are what gives the literals the layout of an interface.
interface View { a: number; b: number; c: number }
const out = [];
const report = (...values: unknown[]) => out.push(values.map(String).join(" "));
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).constructor.name; } };
const shape = (o: object, k: string) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? [typeof d.get, typeof d.set, typeof d.value, d.writable, d.enumerable, d.configurable].join() : "none"; };

function view(x: number): View { return { get a() { return x; }, get b() { return x + 1; }, c: 1 }; }
const v = view(5);
report(v.a, v.b, v.c, Object.keys(v).join(), JSON.stringify(v), shape(v, "a"), shape(v, "c"));
report(Object.entries(v).join("|"), Object.values(v).join(), "a" in v, Object.hasOwn(v, "b"), v.hasOwnProperty("a"));
for (const k in v) report("for-in", k, v[k]);
report("stored over a getter", attempt(() => { v.a = 9; return "no throw"; }), v.a, shape(v, "a"), Reflect.set(v, "a", 9), v.a);

function pair(x) { let kept = x; return { get p() { return kept; }, set p(n) { kept = n * 2; }, q: 0 }; }
const p = pair(1);
p.p = 4;
report(p.p, shape(p, "p"), Object.keys(p).join());
p.p += 1;
report(p.p);

function only(x) { let seen = 0; return { set s(n) { seen = n; }, get seen() { return seen; } }; }
const o = only(1);
report(o.s, shape(o, "s"));
o.s = 3;
report(o.seen, o.s);

function usesThis(n) { return { n, get twice() { return this.n * 2; }, get self() { return this; } }; }
const u = usesThis(4);
report(u.twice, u.self === u);
const below = Object.create(u);
below.n = 10;
report(below.twice, below.self === below, Object.keys(below).join(), "twice" in below, Object.hasOwn(below, "twice"));
report(Reflect.get(u, "twice", { n: 50 }));

const w = view(7);
Object.defineProperty(w, "a", { value: 70, writable: true, enumerable: true, configurable: true });
report("made a value", w.a, shape(w, "a"), Object.keys(w).join(), JSON.stringify(w));
w.a = 71;
report(w.a);
const w2 = view(8);
Object.defineProperty(w2, "a", { get() { return "other"; } });
report("another getter", w2.a, shape(w2, "a"), Object.keys(w2).join());
const w3 = view(9);
Object.defineProperty(w3, "a", { enumerable: false });
report("hidden", w3.a, shape(w3, "a"), Object.keys(w3).join(), JSON.stringify(w3));
const w4 = view(10);
report(delete w4.a, w4.a, shape(w4, "a"), Object.keys(w4).join());
w4.a = 3;
report("stored behind a deletion", w4.a, shape(w4, "a"), Object.keys(w4).join());
const w5 = view(11);
Object.freeze(w5);
report(Object.isFrozen(w5), w5.a, shape(w5, "a"), shape(w5, "c"));
const w6 = view(12);
Object.seal(w6);
report(Object.isSealed(w6), attempt(() => delete w6.a), Reflect.deleteProperty(w6, "a"), w6.a);

const copy = { ...view(13) };
report("spread", copy.a, shape(copy, "a"), Object.keys(copy).join());
const assigned = Object.assign({}, view(14));
report("assigned", assigned.b, shape(assigned, "b"));
const { a: taken, ...rest } = view(15);
report("taken apart", taken, JSON.stringify(rest), shape(rest, "b"));
const into = view(16);
try { Object.assign(into, { a: 1, c: 2 }); report("assigned over", into.a, into.c); } catch (e) { report(e.constructor.name); }

let runs = 0;
function counted() { return { get once() { return ++runs; } }; }
const c = counted();
report(c.once, c.once, runs, JSON.stringify(c), runs, Object.values(c).join(), runs);

function thrower() { return { get bad() { throw new RangeError("bad"); }, fine: 1 }; }
try { thrower().bad; } catch (e) { report(e.constructor.name, e.message); }
try { JSON.stringify(thrower()); } catch (e) { report(e.constructor.name); }
report(Object.keys(thrower()).join(), shape(thrower(), "bad"));

function mixed(flag, x) { return flag ? { get m() { return x; }, z: 1 } : { m: x, z: 2 }; }
report(mixed(true, 1).m, shape(mixed(true, 1), "m"), mixed(false, 2).m, shape(mixed(false, 2), "m"));
function read(o) { return o.m + o.z; }
let sum = 0;
for (let i = 0; i < 200; i++) sum += read(mixed(i % 3 === 0, i));
report(sum);

function order(x) { return { z: 1, get y() { return x; }, x: 2, get w() { return x; }, set w(n) { } }; }
report(Object.keys(order(1)).join(), JSON.stringify(order(2)), Reflect.ownKeys(order(3)).join());

const g = Object.getOwnPropertyDescriptor(view(20), "a").get;
report(typeof g, g.name, g.length, g(), g.call({}), Object.getOwnPropertyDescriptor(view(21), "a").get === g);

let total = 0;
for (let i = 0; i < 300; i++) { const each = view(i); total += each.a + each.b + each.c; }
report(total);

class Holder { constructor(x) { this.view = view(x); } get a() { return this.view.a; } }
report(new Holder(30).a, new Holder(31).view.b);
const kept = [];
for (let i = 0; i < 50; i++) kept.push(view(i));
report(kept.reduce((n, each) => n + each.a, 0), structuredClone(view(40)).a, shape(structuredClone(view(41)), "a"));
console.log(out.join("\n"));
