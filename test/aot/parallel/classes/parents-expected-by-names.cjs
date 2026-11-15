// Unseen code passes the parents. The text of each heir speaks of fields that one class has: the heir lists them. In four cases the parent is another one.
// COUNTER: DynamicSubclassInstances <= 1
"use strict";
globalThis.pass = (value, to) => to(value);
const pass = globalThis.pass, out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
class Base { constructor(n) { this.n = n; this.list = [n]; } add(m) { this.n += m; return this; } get twice() { return this.n * 2; } }
function Cursor(text) { this.text = text; this.pos = 0; this.last = null; }
Cursor.prototype.all = function () { let sum = 0; while (this.pos < this.text.length) sum += this.text.charCodeAt(this.pos++); return sum; };
function Counter() { this.count = 0; this.steps = []; }
Counter.prototype.up = function () { this.count++; this.steps.push(this.count); return this.count; };
class Other { constructor(a) { this.first = a; this.second = { a }; } both() { return [this.first, this.second.a]; } }
class Wrong { constructor() { this.speed = 1; this.weight = 2.5; } }
class Wide { constructor() { this.color = "red"; this.shade = 1; this.width = 2; this.height = 3; } area() { return this.width * this.height; } }

const Heir = pass(Base, (B) => class Heir extends B { constructor(n, m) { super(n); this.m = m; this.other = null; } sum() { return this.n + this.m + this.twice; } });
const Reader = pass(Cursor, (C) => { function Reader(text) { C.call(this, text); this.depth = 1; } Reader.prototype = Object.create(C.prototype); Reader.prototype.constructor = Reader; Reader.prototype.more = function () { return this.pos + this.depth; }; return Reader; });
const Stepper = pass(Counter, (C) => { class Stepper extends C { size = 3; total() { return this.count * this.size + this.steps.length; } } return Stepper; });
let total = 0;
for (let i = 0; i < 60; i++) { const h = new Heir(i, 2); total += h.add(1).sum() + (h.other === null ? 1 : 0); const r = new Reader("ab" + i); total += r.all() + r.more(); const s = new Stepper(); s.up(); s.up(); total += s.total(); }
out.push(total);
for (const object of [new Heir(1, 2), new Reader("xy"), new Stepper()]) {
  out.push(JSON.stringify(object), Object.keys(object).join(), object instanceof Base, object instanceof Cursor, object instanceof Counter, object.constructor.name);
  const keys = []; for (const key in object) keys.push(key);
  out.push(keys.join(), JSON.stringify({ ...object }), JSON.stringify(Object.assign({ z: 1 }, object)));
  object.late = 1; object.n = "text"; object.pos = { x: 1 }; object.count = 1.5; delete object.list; delete object.last;
  out.push(JSON.stringify(object), Object.keys(object).join(), "last" in object, object.hasOwnProperty("list"));
  Object.freeze(object); out.push(show(() => { object.n = 2; }), JSON.stringify(object));
}
// The parent is another one than the text speaks of, has fewer fields, is a builtin class, or calls nothing.
const Fast = pass(Other, (O) => class Fast extends O { limit = 9; go() { return (this.speed || 0) + (this.weight || 0) + this.limit; } });
const Shaded = pass(Array, (A) => class Shaded extends A { tone() { return this.color + this.shade + this.length; } });
const Bare = pass(Counter, (C) => { function Bare() { this.own = 1; } Bare.prototype = Object.create(C.prototype); Bare.prototype.read = function () { return [this.first, this.second, this.own].join(); }; return Bare; });
for (let i = 0; i < 30; i++) { new Fast(i).go(); new Shaded(i).tone(); new Bare().read(); }
const fast = new Fast(4), shaded = new Shaded(1, 2), bare = new Bare();
out.push(JSON.stringify(fast), fast.go(), String(fast.both()), Object.keys(fast).join(), "speed" in fast, fast instanceof Other, fast instanceof Wrong);
fast.speed = 5; fast.weight = "w"; out.push(fast.go(), Object.keys(fast).join(), JSON.stringify(fast));
out.push(JSON.stringify(shaded), shaded.length, shaded.tone(), Object.keys(shaded).join(), Array.isArray(shaded)); shaded.color = 1; shaded.push(3); out.push(Object.keys(shaded).join(), shaded.tone(), shaded.length);
out.push(JSON.stringify(bare), bare.read(), Object.keys(bare).join(), show(() => bare.up())); bare.first = 1; bare.count = 4; bare.steps = []; out.push(bare.up(), Object.keys(bare).join(), bare.read());
out.push(new Wrong().speed + new Wrong().weight, new Wide().area());
class Below extends Heir { extra = [1]; sum() { return super.sum() + this.extra.length; } }
const below = new Below(5, 6); out.push(below.add(2).sum(), JSON.stringify(below), below instanceof Base);
Object.setPrototypeOf(Heir.prototype, Other.prototype); out.push(show(() => new Heir(1, 2).add(1)), show(() => new Heir(1, 2).both()), show(() => JSON.stringify(new Heir(3, 4))));
Object.setPrototypeOf(Heir, Other); out.push(show(() => JSON.stringify(new Heir(3, 4))), show(() => new Heir(7, 8).both()), show(() => new Heir(7, 8).sum()));
for (const line of out) console.log(String(line));
