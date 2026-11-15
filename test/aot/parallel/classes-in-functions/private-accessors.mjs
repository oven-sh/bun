const attempt = f => { try { return f(); } catch (e) { return `${e.name}: ${e.message}`; } };
function accessors() {
  class A { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x & 255; } #m(x) { return x + this.#v; } m(x) { return this.#m(x); } static is(o) { return #v in o; } static peek(o) { return o.#v; } get #w() { return this.#v * 2; } set #w(x) { this.#v = x; } both(x) { this.#w = x; return this.#w; } }
  const a = new A(); let s = 0;
  for (let i = 0; i < 300; i++) { a.v += i & 3; s = (s + a.v + a.m(i) + a.both(i & 7)) | 0; }
  const getter = Object.getOwnPropertyDescriptor(A.prototype, "v").get, setter = Object.getOwnPropertyDescriptor(A.prototype, "v").set;
  console.log("accessors", s, A.is(a), A.is({}), A.peek(a), attempt(() => A.peek({})), attempt(() => getter.call({})), attempt(() => setter.call({}, 1)), attempt(() => A.prototype.m.call({}, 1)), attempt(() => A.is(1)));
  return { A, a, getter, setter };
}
const kept = accessors();
console.log("kept", kept.a.v, kept.getter.call(kept.a), kept.A.is(new kept.A()), attempt(() => kept.getter.call(new (class { #v = 1; })())));
function twice(n) { class T { #v = n; get v() { return this.#v; } set v(x) { this.#v = x; } static read(o) { return o.#v; } has(o) { return #v in o; } } return T; }
const T1 = twice(1), T2 = twice(2), t1 = new T1(), t2 = new T2();
let total = 0; for (let i = 0; i < 300; i++) { t1.v += 1; t2.v += 2; total += t1.v + t2.v; }
console.log("twice", total, T1.read(t1), T2.read(t2), attempt(() => T1.read(t2)), attempt(() => T2.read(t1)), t1.has(t2), t1.has(t1));
function heirs() {
  class B { #b = 1; get b() { return this.#b; } set b(x) { this.#b = x; } sum() { return this.#b + 1; } }
  class C extends B { #c = 2; get c() { return this.#c + this.b; } set c(x) { this.#c = x; this.b = x + 1; } sum() { return super.sum() + this.#c; } }
  class D extends C { get c() { return super.c + 1; } set c(x) { super.c = x * 2; } }
  const list = [new B(), new C(), new D()]; let s = 0;
  for (let i = 0; i < 300; i++) { const o = list[i % 3]; o.b += 1; s += o.sum(); if (i % 3) { o.c = i & 7; s += o.c; } }
  console.log("heirs", s, list.map(o => o.sum()).join());
}
heirs();
function early() {
  const seen = [];
  class E { static #n = 0; static get n() { return E.#n; } static set n(x) { E.#n = x; seen.push(x); } static first = (E.n = 3, E.n); static { this.n += 2; } #i = ++E.n; get i() { return this.#i; } }
  const e = new E(); let s = 0;
  for (let i = 0; i < 300; i++) { E.n += 1; s += E.n + e.i; }
  console.log("early", s, E.first, e.i, seen.length);
}
early();
function thrown(fails) {
  let made;
  try { class X { #v = 1; get v() { return this.#v; } static s = fails ? (() => { throw new RangeError("static"); })() : 1; } made = X; } catch (e) { console.log("thrown", e.name, e.message); return 0; }
  const x = new made(); let s = 0; for (let i = 0; i < 300; i++) s += x.v; return s;
}
console.log("thrown", thrown(false), thrown(true), thrown(false));
function once(flag) {
  let K = null;
  if (flag) K = class { #v = 5; get v() { return this.#v; } set v(x) { this.#v = x; } };
  const o = K ? new K() : { v: 3 }; let s = 0;
  for (let i = 0; i < 300; i++) { o.v += 1; s += o.v; }
  return s;
}
console.log("once", once(false));
function inLoop() {
  const made = [];
  for (let k = 0; k < 4; k++) made.push(class { #v = k; get v() { return this.#v; } set v(x) { this.#v = x + k; } static read(o) { return o.#v; } });
  const objects = made.map(M => new M()); let s = 0;
  for (let i = 0; i < 300; i++) { const o = objects[i & 3]; o.v = i; s += o.v; }
  console.log("inLoop", s, made.map((M, k) => attempt(() => M.read(objects[(k + 1) & 3]))).join(" | "));
}
inLoop();
function* generated() { class G { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x; } } const g = new G(); for (let i = 0; i < 4; i++) { g.v += i; yield g.v; } }
console.log("generated", [...generated()].join(), [...generated()].join());
async function awaited() { class G { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x; } } const g = new G(); for (let i = 0; i < 4; i++) { g.v += await i; } return g.v; }
console.log("awaited", await awaited(), await awaited());
function nested() {
  class Outer { #v = 1; get v() { return this.#v; } make() { const outer = this; return new (class Inner { #w = 2; get sum() { return this.#w + outer.#v; } set sum(x) { this.#w = x; outer.#v = x; } })(); } }
  const o = new Outer(), i1 = o.make(), i2 = o.make(); let s = 0;
  for (let i = 0; i < 300; i++) { i1.sum = i & 3; i2.sum = i & 1; s += i1.sum + i2.sum + o.v; }
  console.log("nested", s);
}
nested();
function replaced() {
  class R { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x; } }
  const r = new R(); let s = 0;
  for (let i = 0; i < 100; i++) { r.v += 1; s += r.v; }
  Object.defineProperty(R.prototype, "v", { get() { return 7; }, set(x) { s += x; }, configurable: true });
  for (let i = 0; i < 100; i++) { r.v += 1; s += r.v; }
  delete R.prototype.v;
  for (let i = 0; i < 3; i++) { r.v = i; s += r.v; }
  console.log("replaced", s, Object.keys(r).join());
}
replaced();
function odd() {
  class R { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x; } }
  const frozen = Object.freeze(new R()), sealed = Object.seal(new R()), closed = Object.preventExtensions(new R()), moved = Object.setPrototypeOf(new R(), null), below = Object.create(new R()), proxy = new Proxy(new R(), {}), own = Object.defineProperty(new R(), "v", { value: 9 });
  const rows = [];
  for (const [n, o] of [["frozen", frozen], ["sealed", sealed], ["closed", closed], ["moved", moved], ["below", below], ["proxy", proxy], ["own", own]]) rows.push(n, attempt(() => o.v), attempt(() => { o.v = 4; return o.v; }));
  console.log("odd", rows.join(" "));
}
odd();
(() => { class Arrow { #v = 1; get v() { return this.#v; } set v(x) { this.#v = x; } } const o = new Arrow(); let s = 0; for (let i = 0; i < 300; i++) { o.v += i; s = (s + o.v) | 0; } console.log("arrow", s); })();
function recursive(n) { class N { #v = n; get v() { return this.#v; } next = n ? recursive(n - 1) : null; has(o) { return #v in o; } } return new N(); }
{ const r = recursive(3); let s = 0; for (let o = r; o; o = o.next) s += o.v; console.log("recursive", s, r.has(r.next), r.has(r)); }
