// The own stores of heirs of unseen parents are in line where nothing above the objects stops them. Setters, read-only properties and proxies above are seen, early and late.
// COUNTER: StructuresPassingStores >= 1
"use strict";
globalThis.pass = (value, to) => to(value);
const pass = globalThis.pass, out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const text = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + (d.writable ? "" : "!") + (d.enumerable ? "" : "-") + "=" + ("value" in d ? (Object.is(d.value, -0) ? "-0" : typeof d.value === "object" && d.value ? JSON.stringify(d.value) : String(d.value)) : "accessor"); }).join();
class Base { constructor(n) { this.n = n; this.list = []; } add(m) { this.n += m; return this; } get twice() { return this.n * 2; } }
class Plain { constructor(a) { this.first = a; } both() { return this.first + this.m; } }
function Old(a) { this.old = a; this.pos = 0; }
Old.prototype.next = function () { return this.pos++; };
const make = (B) => class Heir extends B { constructor(n, m) { super(n); this.m = m; this.other = null; this.third = n; this.fourth = 1.5; } sum() { return this.n + this.m + this.twice + this.fourth; } };

// Several evaluations, with parents of several kinds.
const classes = [pass(Base, make), pass(Plain, make), pass(Old, make), pass(class extends Base { late = 1; }, make), pass(Object, make)];
let total = 0;
for (let i = 0; i < 80; i++) for (const C of classes) { const o = new C(i, i + 1); total += o.m + o.third + o.fourth + (o.other === null ? 1 : 0); }
out.push(total, classes[0] && new classes[0](1, 2).sum());
for (const C of classes) out.push(text(new C(3, -0)), text(new C("s", { x: 1 })), text(new C(undefined, NaN)), JSON.stringify(new C(5, 6)), new C(1, 2) instanceof C);

// A setter, a getter alone, a read-only property above: before the first object, and behind many.
const seen = [];
class WithSetter { constructor(n) { this.n = n; } set m(v) { seen.push("m" + v); } get other() { return 7; } set other(v) { seen.push("o" + v); } }
const Set1 = pass(WithSetter, make);
for (let i = 0; i < 40; i++) new Set1(i, i);
out.push(seen.length, seen.slice(-2).join(), text(new Set1(1, 2)));
class WithGetter { get third() { return 3; } }
const Get1 = pass(WithGetter, make);
for (let i = 0; i < 40; i++) total += show(() => new Get1(i, 1)).length;
out.push(total, show(() => new Get1(1, 1)));
for (const [change, name] of [
  [(p) => Object.defineProperty(p, "m", { set(v) { seen.push("late" + v); }, configurable: true }), "setter"],
  [(p) => Object.defineProperty(p, "other", { value: 4, writable: false, configurable: true }), "read-only"],
  [(p) => { p.third = 1; Object.freeze(p); }, "frozen"],
  [(p) => Object.setPrototypeOf(p, new Proxy({}, { set(t, k, v, r) { seen.push("trap" + String(k)); return Reflect.defineProperty(r, k, { value: v, writable: true, enumerable: true, configurable: true }); } })), "proxy"],
  [(p) => Object.setPrototypeOf(p, { set fourth(v) { seen.push("far" + v); } }), "link"],
  [(p) => Object.setPrototypeOf(p, null), "null"],
  [(p) => { p.m = 5; p.other = 6; p.added = () => 1; }, "values"],
  [(p) => { p.m = 5; Object.defineProperty(p, "m", { writable: false }); }, "value, then read-only"],
]) {
  class Parent { constructor(n) { this.n = n; } }
  const H = pass(Parent, make); seen.length = 0;
  for (let i = 0; i < 50; i++) new H(i, 1);
  out.push(show(() => change(Parent.prototype)));
  for (let i = 0; i < 3; i++) out.push(name, show(() => text(new H(i, 2))));
  out.push(seen.join());
  show(() => delete Parent.prototype.m); show(() => delete Parent.prototype.other);
  for (let i = 0; i < 50; i++) total += show(() => text(new H(i, 1))).length;
  out.push(show(() => change(H.prototype)));
  for (let i = 0; i < 3; i++) out.push(show(() => text(new H(i, 2))));
  out.push(seen.length);
}
// The parent gives another object, or one that takes no properties, or one that has the names.
const kinds = [
  () => Object.freeze({ m: 1 }), () => Object.preventExtensions({}), () => [1, 2], () => new Proxy({}, { defineProperty(t, k, d) { seen.push("d" + String(k)); return Reflect.defineProperty(t, k, d); } }),
  () => Object.defineProperty({}, "m", { set(v) { seen.push("own" + v); }, get() { return 8; }, enumerable: true, configurable: true }), () => Object.create({ set m(v) { seen.push("above" + v); } }), () => function f() {}, () => new Map(),
  (self) => Object.preventExtensions(self), (self) => Object.freeze(self), (self) => Object.defineProperty(self, "other", { value: 1, writable: false, configurable: true }), (self) => Object.assign(self, { fourth: 1, m: 2 }), (self) => Object.setPrototypeOf(self, { set third(v) { seen.push("mine" + v); } }),
];
for (const kind of kinds) {
  const H = pass(class { constructor(n) { this.n = n; if (n > 20) return kind(this); } }, make); seen.length = 0;
  for (let i = 0; i <= 20; i++) new H(i, 1);
  for (const n of [21, 22]) out.push(show(() => text(new H(n, 3))));
  out.push(seen.join(), text(new H(1, 2)));
}
// What is above changes between two stores.
let act = () => {};
const Steps = pass(Base, (B) => class extends B { constructor(n) { super(n); this.a = 1; act(this); this.b = 2; this.c = act(this); this.d = 4; } });
for (let i = 0; i < 50; i++) new Steps(i);
let times = 0;
act = (o) => { if (times++ === 2) Object.defineProperty(Steps.prototype, "d", { set(v) { seen.push("d" + v); }, configurable: true }); if (times === 5) Object.defineProperty(Base.prototype, "b", { value: 0, writable: false, configurable: true }); return times; };
for (let i = 0; i < 4; i++) out.push(show(() => text(new Steps(i))));
out.push(seen.slice(-3).join()); delete Base.prototype.b;
// The heir lists the fields of the parent, which its text names.
class Quiet { constructor(n) { this.quiet = n; this.loud = 0; } both() { return this.quiet + this.loud; } }
const Said = pass(Quiet, (B) => class Said extends B { constructor(n, m) { super(n); this.said = m; this.more = null; this.half = 1.5; } all() { return this.quiet + this.loud + this.said + this.half; } });
for (let i = 0; i < 60; i++) { const o = new Said(i, 2); total += o.all() + o.both() + (o.more === null ? 1 : 0); }
out.push(total, text(new Said(1, -0)), text(new Said("a", [1])), new Said(2, 3).all());
Object.defineProperty(Quiet.prototype, "more", { set(v) { seen.push("more" + v); }, configurable: true });
for (let i = 0; i < 3; i++) out.push(text(new Said(i, 1)), seen.slice(-1).join());
delete Quiet.prototype.more; for (let i = 0; i < 20; i++) new Said(i, 1);
out.push(text(new Said(4, 5)));
Object.defineProperty(Said.prototype, "half", { value: 2, writable: false, configurable: true }); out.push(show(() => text(new Said(5, 6))));
delete Said.prototype.half; Object.setPrototypeOf(Quiet.prototype, { set said(v) { seen.push("said" + v); } }); out.push(text(new Said(7, 8)), seen.slice(-1).join());
Object.setPrototypeOf(Quiet.prototype, Object.prototype); for (let i = 0; i < 20; i++) new Said(i, 1); out.push(text(new Said(9, 10)));
// Another class is constructed: new.target's prototype is what is above.
const First = pass(Base, make); for (let i = 0; i < 30; i++) new First(i, 1);
function Target() {} Target.prototype = { set m(v) { seen.push("target" + v); } };
out.push(text(Reflect.construct(First, [1, 2], Target)), text(Reflect.construct(First, [1, 2], Array)), text(Reflect.construct(First, [1, 2], class extends First {})), seen.slice(-1).join());
// A class for each object.
for (let i = 0; i < 40; i++) { const H = pass(i % 3 ? Base : WithSetter, make); const a = new H(i, 1), b = new H(i, 2); total += text(a).length + text(b).length; }
out.push(total);
// Fields, symbols, names that Object.prototype has.
const mark = Symbol("mark");
const Odd = pass(Plain, (B) => class extends B { field = 1; #hidden = 2; constructor(a) { super(a); this[mark] = a; this.toString = 5; this.constructor = 6; this.valueOf = null; this["1x"] = this.#hidden; } });
for (let i = 0; i < 30; i++) total += new Odd(i).field;
out.push(text(new Odd(1)), total);
for (const line of out) console.log(String(line));
