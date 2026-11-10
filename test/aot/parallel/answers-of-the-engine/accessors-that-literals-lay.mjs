// Accessors that literals lay, as a program sees them: what a read and a store find, the keys in their order, the descriptors, what a deletion, a definition, a freeze, a copy and an heir make of them. Where nothing but such accessors is seen to fill a field, its slot holds the pair of functions.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const line = (...values) => { let text = ""; for (let i = 0; i < values.length; i++) text += (i ? " " : "") + String(values[i]); return text; };
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const shape = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? [typeof d.get, typeof d.set, typeof d.value, d.writable, d.enumerable, d.configurable].join() : "none"; };
function view(x) { return { get a() { return x; }, get b() { return x + 1; }, c: 1 }; }
const v = view(5);
report(line(v.a, v.b, v.c, Object.keys(v).join(), JSON.stringify(v), shape(v, "a"), shape(v, "c")));
report(line("a" in v, Object.hasOwn(v, "b"), v.hasOwnProperty("a")));
let listed = "";
for (const k in v) listed += k + "=" + v[k] + ";";
report(line("for-in", listed));
report(line("stored over a getter", attempt(() => { v.a = 9; return "no throw"; }), v.a, shape(v, "a"), Reflect.set(v, "a", 9), v.a));
function pair(x) { let kept = x; return { get p() { return kept; }, set p(n) { kept = n * 2; }, q: 0 }; }
const p = pair(1);
p.p = 4;
report(line(p.p, shape(p, "p"), Object.keys(p).join()));
p.p += 1;
report(line(p.p));
function only(x) { let seen = 0; return { set s(n) { seen = n; }, get seen() { return seen; } }; }
const o = only(1);
report(line(o.s, shape(o, "s")));
o.s = 3;
report(line(o.seen, o.s));
function usesThis(n) { return { n, get twice() { return this.n * 2; }, get self() { return this; } }; }
const u = usesThis(4);
report(line(u.twice, u.self === u));
const below = Object.create(u);
below.n = 10;
report(line(below.twice, below.self === below, Object.keys(below).join(), "twice" in below, Object.hasOwn(below, "twice")));
report(line(Reflect.get(u, "twice", { n: 50 })));
const w = view(7);
Object.defineProperty(w, "a", { value: 70, writable: true, enumerable: true, configurable: true });
report(line("made a value", w.a, shape(w, "a"), Object.keys(w).join(), JSON.stringify(w)));
w.a = 71;
report(line(w.a));
const w2 = view(8);
Object.defineProperty(w2, "a", { get() { return "other"; } });
report(line("another getter", w2.a, shape(w2, "a"), Object.keys(w2).join()));
const w3 = view(9);
Object.defineProperty(w3, "a", { enumerable: false });
report(line("hidden", w3.a, shape(w3, "a"), Object.keys(w3).join(), JSON.stringify(w3)));
const w4 = view(10);
report(line(delete w4.a, w4.a, shape(w4, "a"), Object.keys(w4).join()));
w4.a = 3;
report(line("stored behind a deletion", w4.a, shape(w4, "a"), Object.keys(w4).join()));
const w5 = view(11);
Object.freeze(w5);
report(line(Object.isFrozen(w5), w5.a, shape(w5, "a"), shape(w5, "c")));
const w6 = view(12);
Object.seal(w6);
report(line(Object.isSealed(w6), attempt(() => delete w6.a), Reflect.deleteProperty(w6, "a"), w6.a));
const copy = { ...view(13) };
report(line("spread", copy.a, shape(copy, "a"), Object.keys(copy).join()));
const assigned = Object.assign({}, view(14));
report(line("assigned", assigned.b, shape(assigned, "b")));
const { a: taken, ...rest }
= view(15);
report(line("taken apart", taken, JSON.stringify(rest), shape(rest, "b")));
const into = view(16);
report(line("assigned over", attempt(() => { Object.assign(into, { a: 1, c: 2 }); return "no throw"; }), into.a, into.c));
let runs = 0;
function counted() { return { get once() { return ++runs; } }; }
const c = counted();
report(line(c.once, c.once, runs, JSON.stringify(c), runs));
function thrower() { return { get bad() { throw new RangeError("bad"); }, fine: 1 }; }
report(line(attempt(() => thrower().bad)));
report(line(attempt(() => JSON.stringify(thrower()))));
report(line(Object.keys(thrower()).join(), shape(thrower(), "bad")));
function mixed(flag, x) { return flag ? { get m() { return x; }, z: 1 } : { m: x, z: 2 }; }
report(line(mixed(true, 1).m, shape(mixed(true, 1), "m"), mixed(false, 2).m, shape(mixed(false, 2), "m")));
function read(o) { return o.m + o.z; }
let sum = 0;
for (let i = 0; i < 200; i++) sum += read(mixed(i % 3 === 0, i));
report(line(sum));
function order(x) { return { z: 1, get y() { return x; }, x: 2, get w() { return x; }, set w(n) { } }; }
report(line(Object.keys(order(1)).join(), JSON.stringify(order(2)), Reflect.ownKeys(order(3)).join()));
const g = Object.getOwnPropertyDescriptor(view(20), "a").get;
report(line(typeof g, g.name, g.length, g(), Object.getOwnPropertyDescriptor(view(21), "a").get === g));
let total = 0;
for (let i = 0; i < 300; i++) { const each = view(i); total += each.a + each.b + each.c; }
report(line(total));
class Holder { constructor(x) { this.view = view(x); } get a() { return this.view.a; } }
report(line(new Holder(30).a, new Holder(31).view.b));
const kept = [];
for (let i = 0; i < 50; i++) kept.push(view(i));
let all = 0;
for (let i = 0; i < kept.length; i++) all += kept[i].a;
report(line(all));
report("end");
