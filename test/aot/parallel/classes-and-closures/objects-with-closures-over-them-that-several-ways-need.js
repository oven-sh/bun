// Objects that hold closures over themselves: literals, instances of classes and of their heirs, in loops, in front of a throw, handed on by one way of several,
// by every way and by none. Stores stand between the closures and the place where the ways part.
const log = [];
const kept = [];
function keep(o) {
  kept.push(o);
  if (kept.length > 4) kept.shift();
  return o;
}
function look(o) {
  return Object.keys(o).join() + "|" + (typeof o.f === "function" ? o.f() === o : "-");
}
class Base {
  name = "base";
  self = () => this;
  count = 0;
  bump = () => ++this.count;
  constructor(a, flag) {
    this.a = a;
    if (flag) this.name = "flagged";
    this.count = a;
  }
}
class Derived extends Base {
  extra = () => this.a + this.count;
  late;
  constructor(a, flag) {
    super(a, flag);
    this.late = flag ? this.extra : null;
    this.name += "!";
  }
}
class Throws {
  f = () => this;
  x = 1;
  constructor(i) {
    this.x = i;
    if (i % 7 === 3) throw new Error("no " + Object.keys(this).join() + (this.f() === this));
    this.y = i + 1;
  }
}
function literal(i, c) {
  const o = {};
  o.env = {};
  o.f = () => o;
  o.g = () => o.env;
  o.env = i;
  o.x = i + 1;
  if (c) keep(o);
  else o.x = 0;
  return look(o) + o.g() + o.x;
}
function meets(i) {
  const o = { a: i };
  o.f = () => o;
  o.a = i * 2;
  let r = 0;
  if (i & 1) r = keep(o).a;
  if (i & 2) o.a++;
  if (i & 4) r += keep(o).f().a;
  return r + o.a + (o.f === o.f ? 1 : 0);
}
function inLoop(n) {
  let sum = 0;
  let last = null;
  for (let i = 0; i < n; i++) {
    const o = { i, prev: null };
    o.f = () => o;
    o.prev = i & 1 ? last : null;
    if (i % 3 === 0) last = o;
    sum += o.f().i + (o.prev ? o.prev.i : 0);
  }
  return sum + (last ? last.f().i : -1);
}
function tried(i) {
  try {
    const t = new Throws(i);
    if (i & 1) keep(t);
    return t.x + t.y + (t.f() === t ? 1 : 0);
  } catch (e) {
    return e.message;
  }
}
function classes(i) {
  const d = new Derived(i, (i & 3) === 0);
  if (i % 5 === 0) keep(d);
  d.bump();
  const b = new Base(i, i & 1);
  const s = b.self();
  if (i % 11 === 0) return Object.keys(d).join() + Object.keys(s).join() + d.name + s.name;
  return d.name + d.count + (d.late ? d.late() : "n") + (d.self() === d) + b.name + s.count + b.bump();
}
function calledEarly(i) {
  const o = { v: i };
  o.f = () => o.v;
  const early = o.f();
  o.v = i + 1;
  if (i & 1) keep(o);
  return early + o.f();
}
let h = 0;
function mix(s) {
  s = String(s);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
}
for (let i = 0; i < 20000; i++) {
  mix(literal(i, (i & 3) === 1));
  mix(meets(i));
  mix(tried(i));
  mix(classes(i));
  mix(calledEarly(i));
}
mix(inLoop(5000));
console.log(h, literal(1, true), literal(2, false), meets(7), tried(3), tried(4), classes(0), classes(1), classes(11), calledEarly(3), kept.length, kept.map(look).join(" "));
