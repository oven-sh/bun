// A store by name that creates a field of an instance asks whether anything above the instance stops it. What is remembered about that lives through collections:
// it has to end with the shape it is about, whose number goes to another shape, and with every change above.
const shelf = globalThis;
const shelfKey = process.env.SHELF || "shelf";
function hide(x) { shelf[shelfKey] = x; return shelf[shelfKey]; }
const lines = [];

class Base { constructor(a) { this.a = a; } }
class Middle extends Base { constructor(a) { super(a); this.m = 1; } }
class Leaf extends Middle { constructor(a) { super(a); this.l = 2; } }
function make(i) { return i % 3 === 0 ? new Base(i) : i % 3 === 1 ? new Middle(i) : new Leaf(i); }
// The compiler sees these stores, so the names are fields of the three layouts.
function seed() {
  for (let i = 0; i < 3; i++) { const o = make(i); o.late = i; o.other = i; }
}
function storeLate(o, v) { o.late = v; }
function storeOther(o, v) { o.other = v; }

function round(title, n) {
  let own = 0, ownOther = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const o = hide(make(i));
    try { storeLate(o, i); } catch (e) { sum += 1000000; }
    try { storeOther(o, i); } catch (e) { sum += 1000; }
    if (Object.hasOwn(o, "late")) own++;
    if (Object.hasOwn(o, "other")) ownOther++;
    sum += (o.late | 0) + (o.other | 0);
  }
  lines.push(title + ": " + own + " " + ownOther + " " + sum + " " + seen);
}

let seen = 0;
seed();
round("as declared", 600);
Bun.gc(true);
round("after a collection", 600);
Object.defineProperty(Middle.prototype, "late", { set(v) { seen += v; }, get() { return 7; }, configurable: true });
round("a setter in the middle", 600);
Bun.gc(true);
round("a setter in the middle, after a collection", 600);
delete Middle.prototype.late;
Bun.gc(true);
round("the setter is gone", 600);
Object.defineProperty(Base.prototype, "other", { value: 5, writable: false, configurable: true });
Bun.gc(true);
round("read-only at the top", 600);
Object.defineProperty(Base.prototype, "other", { value: 5, writable: true, configurable: true });
round("writable again", 600);
Bun.gc(true);
Object.setPrototypeOf(Middle.prototype, { set late(v) { seen -= v; }, get late() { return 9; } });
round("another object above the middle", 600);
Bun.gc(true);
round("another object above the middle, after a collection", 600);

// Classes that are evaluated again and again: their shapes end, and the numbers of the shapes go to the shapes of the next ones, of which every other declares a setter.
// Nothing reports a change: each prototype is as its class declares it from the start.
function evaluate(withSetter) {
  return withSetter
    ? class { constructor(a) { this.a = a; } set late(v) { seen += 1; } get late() { return -1; } }
    : class { constructor(a) { this.a = a; } };
}
// So that the name is a field of both layouts: a definition passes the setter by.
function seedEvaluated() {
  const plain = new (evaluate(false))(1);
  plain.late = 1;
  const below = new (evaluate(true))(1);
  Object.defineProperty(below, "late", { value: 2, writable: true, enumerable: true, configurable: true });
  return plain.late + below.late;
}
seedEvaluated();
let ownOfPlain = 0, ownOfSetter = 0;
for (let turn = 0; turn < 400; turn++) {
  const withSetter = turn % 2 === 1;
  const K = evaluate(withSetter);
  for (let i = 0; i < 24; i++) {
    const o = hide(new K(i));
    storeLate(o, i);
    if (Object.hasOwn(o, "late")) { if (withSetter) ownOfSetter++; else ownOfPlain++; }
  }
  shelf[shelfKey] = undefined;
  Bun.gc(true);
}
lines.push("evaluated again and again: " + ownOfPlain + " " + ownOfSetter + " " + seen);
console.log(lines.join("\n"));
