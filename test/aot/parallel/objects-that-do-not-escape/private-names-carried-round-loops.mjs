// A loop carries an object with private names that nothing else names by its fields.
const kept = [];
const xs = [];
for (let i = 0; i < 20; i++) xs.push(((i * 37) % 11) / 4);

class Vector {
  #x = 0;
  #y = 0;
  static #zero = new Vector(0, 0);
  constructor(x, y) { this.#x = x; this.#y = y; }
  static get zero() { return Vector.#zero; }
  static add(a, b) { return new Vector(a.#x + b.#x, a.#y + b.#y); }
  static is(o) { return typeof o === "object" && o !== null && #x in o; }
  scale(k) { return new Vector(this.#x * k, this.#y * k); }
  move(d) { this.#x += d; return this; }
  limit() { this.#x = this.#x > 9 ? 9 : this.#x; this.#y = this.#y > 9 ? 9 : this.#y; return this; }
  keep() { kept.push(this); return this; }
  #sum() { return this.#x + this.#y; }
  get sum() { return this.#sum(); }
  get x() { return this.#x; }
  text() { return `<${Object.is(this.#x, -0) ? "-0" : this.#x} ${this.#y}>`; }
}
class Named extends Vector {
  #name;
  constructor(x, y, name) { super(x, y); this.#name = name; }
  next(i) { return new Named(this.x + i, 1, this.#name + i); }
  text() { return this.#name + super.text(); }
}
const counted = Base => class extends Base {
  #count = 1;
  next(v) { const made = new this.constructor(this.x + v, 2); made.#count = this.#count + 1; return made; }
  text() { return super.text() + "#" + this.#count; }
};
const Counted = counted(Vector), Again = counted(Named);

function added(n) { let p = new Vector(0, 1); for (let i = 0; i < n; i++) p = Vector.add(p, new Vector(xs[i % 20], 0.5)); return p.text(); }
function limited(n) { let p = new Vector(-0, 1); for (let i = 0; i < n; i++) { p = p.scale(1.5); if (i & 1) p = Vector.add(p, p); p.limit(); } return p.limit().text(); }
function movedInPlace(n) { const p = new Vector(1, 2); for (let i = 0; i < n; i++) p.move(xs[i % 20]); return p.text() + p.sum; }
function keptAtTimes(n) { let p = new Vector(0, 0), t = 0; for (let i = 0; i < n; i++) { p = Vector.add(p, new Vector(1, i)); if (i % 7 === 3) p.keep(); t += p.sum; } return p.text() + t; }
function widened(n) { let p = new Vector(0, 1); for (let i = 0; i < n; i++) p = new Vector(i === 12 ? "late" : p.x, i); return p.text(); }
function named(n) { let p = new Named(0, 0, "n"); for (let i = 0; i < n; i++) p = p.next(i); return p.text(); }
function eitherClass(n) { let p = new Vector(0, 1); for (let i = 0; i < n; i++) p = i === 9 ? new Named(p.x, 1, "either") : Vector.add(p, new Vector(1, 1)); return p.text() + Vector.is(p); }
function ofMadeClasses(n) { let p = new Counted(0, 0); for (let i = 0; i < n; i++) p = p.next(1); let q = new Again(0, 0, "again"); for (let i = 0; i < n; i++) q = q.next(2); return p.text() + q.text(); }
function swapped(n) { let a = new Vector(0, 1), b = new Vector(2, 3); for (let i = 0; i < n; i++) { const c = a; a = Vector.add(b, c); b = c; } return a.text() + b.text(); }
function zeroAtTimes(n) { let p = new Vector(0, 0.5); for (let i = 0; i < n; i++) p = p.x > 5 ? Vector.zero : p.move(1); return p.text() + Vector.zero.text(); }
function thrown(n) { let p = new Vector(0, 0); try { for (let i = 0; ; i++) { p = Vector.add(p, new Vector(i, 1)); if (i === n) throw p; } } catch (e) { return e.text() + p.text() + (e === p); } }
function foreign(n) { let p = new Vector(0, 0), m = ""; for (let i = 0; i < n; i++) { try { p = Vector.add(p, i === 5 ? { x: 1 } : new Vector(i, 0)); } catch (e) { m += e.constructor.name; } } return p.text() + m; }

for (let round = 0; round < 3; round++) {
  for (const f of [added, limited, movedInPlace, keptAtTimes, widened, named, eitherClass, ofMadeClasses, swapped, zeroAtTimes, thrown, foreign])
    for (const n of [0, 1, 6, 17, 40]) console.log(f.name, n, f(n));
  console.log(kept.map(p => p.text()).join(" "));
  kept.length = 0;
}
