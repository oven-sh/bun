// Constructor functions whose parent is a parameter that unseen code fills: their objects may have the layout of the parent's objects.
// COUNTER: DynamicSubclassInstances >= 12
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
globalThis.pass = (value, to) => to(value);
const pass = globalThis.pass;
function Cursor(text) { this.text = text; this.pos = 0; this.type = "eof"; this.start = 0; this.end = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.end = this.pos; this.pos++; this.type = "name"; this.value = this.end - this.start; return this.value; };
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.step(); return n; };
Cursor.prototype.kind = function () { return "cursor"; };
Object.defineProperty(Cursor.prototype, "rest", { get() { return this.text.length - this.pos; }, set(v) { this.pos = this.text.length - v; }, configurable: true });
function Pair(a, b) { this.a = a; this.b = b; }
Pair.prototype.sum = function () { return this.a + this.b; };
class Shape { constructor(n) { this.n = n; this.list = [n]; this.tag = "shape"; } area() { return this.n * this.n; } }

// Object.create, the parent's call first
const created = (Base) => {
  function Heir(text) { Base.call(this, text); this.extra = 1; }
  Heir.prototype = Object.create(Base.prototype); Heir.prototype.constructor = Heir;
  Heir.prototype.more = function () { return this.extra + this.pos; };
  return Heir;
};
// own fields first, the parent's call last, or never
const late = (Base) => {
  function Late(text, calls) { this.extra = 1; this.second = [2]; if (calls) Base.call(this, text); }
  Late.prototype = Object.create(Base.prototype, { constructor: { value: Late, writable: true, configurable: true } });
  Late.prototype.kind = function () { return "late " + Base.prototype.kind.call(this); };
  return Late;
};
// apply, no field of its own
const applied = (Base) => {
  function Applied() { return Base.apply(this, arguments) || this; }
  Applied.prototype = Object.create(Base.prototype); Applied.prototype.constructor = Applied;
  return Applied;
};
// util.inherits
const inherits = (Base) => {
  function Inherits(text) { if (!(this instanceof Inherits)) return new Inherits(text); Base.call(this, text); this.depth = 3; }
  require("util").inherits(Inherits, Base);
  Inherits.prototype.step = function () { this.depth++; return Base.prototype.step.call(this); };
  return Inherits;
};
// Object.setPrototypeOf
const linked = (Base) => {
  function Linked(text) { const self = Base.call(this, text) || this; self.linked = true; return self; }
  Object.setPrototypeOf(Linked, Base); Object.setPrototypeOf(Linked.prototype, Base.prototype);
  return Linked;
};
// many fields of its own
const many = (Base) => {
  function Many(text) { Base.call(this, text); this.a = 1; this.b = 2; this.c = 3; this.d = 4; this.e = 5; this.f = 6; this.g = 7; this.h = 8; }
  Many.prototype = Object.create(Base.prototype); Many.prototype.constructor = Many;
  Many.prototype.total = function () { return this.a + this.b + this.c + this.d + this.e + this.f + this.g + this.h + this.pos; };
  return Many;
};
const makers = { created, late, applied, inherits, linked, many };
const text = "alpha beta gamma";
const classes = {};
for (const [name, maker] of Object.entries(makers)) classes[name] = pass(Cursor, maker);
for (const [name, Heir] of Object.entries(classes)) {
  let total = 0;
  for (let i = 0; i < 40; i++) { const h = new Heir(text, i !== 7); total += show(() => h.all()).length + (h.value || 0); }
  const h = new Heir(text, true);
  out.push(name, total, h.all(), Object.keys(h).join(), JSON.stringify(h), h instanceof Heir, h instanceof Cursor, h.kind(), h.rest, Object.getPrototypeOf(h) === Heir.prototype, h.constructor.name);
  h.rest = 4; h.pos += 1; h.text = "a b"; h.type = 5; h.value = "v"; h.start = 1.5; h.end = { valueOf() { return 2; } };
  out.push(h.pos, h.text, h.type, h.value, h.start, h.end + 1, h.more ? h.more() : h.total ? h.total() : "", Object.keys(h).join());
  delete h.start; h.start = "again"; h.added = 1;
  out.push(Object.keys(h).join(), "start" in h, h.hasOwnProperty("pos"), show(() => h.step()));
  const keys = []; for (const key in h) keys.push(key);
  out.push(keys.join(), Object.isFrozen(Object.freeze(h)), show(() => { h.pos = 9; }), h.pos);
}
// the parent's constructor is never called: none of its fields exist
const bare = new classes.late(text, false);
out.push(Object.keys(bare).join(), bare.pos, "pos" in bare, show(() => bare.step()), show(() => bare.all()), bare.kind());
bare.pos = 3; out.push(Object.keys(bare).join(), bare.pos, show(() => bare.rest));
Cursor.call(bare, "x y"); out.push(bare.all(), Object.keys(bare).join());
// called without new, with a receiver of its own, through Reflect.construct, below a class
out.push(classes.inherits(text).all(), show(() => classes.created(text)));
const receiver = {}; classes.created.call(receiver, "p q"); out.push(JSON.stringify(receiver));
const made = Reflect.construct(classes.created, ["r s"], classes.late); out.push(Object.keys(made).join(), made instanceof classes.late, made.kind(), made.all());
class Below extends classes.created { constructor(t) { super(t); this.below = 1; } more() { return super.more() * 10; } }
const below = new Below("t u v"); out.push(Object.keys(below).join(), below.all(), below.more(), below instanceof Cursor);
// heirs of heirs
const Second = pass(classes.created, created), Third = pass(Second, inherits);
for (let i = 0; i < 20; i++) new Third("w x");
const third = new Third("w x y z"); out.push(Object.keys(third).join(), third.all(), third.more(), third.depth, third instanceof Second, third instanceof Cursor);
// other parents: fewer fields, a class, builtin ones, none
out.push(JSON.stringify(new (pass(Pair, (Base) => { function P(a, b) { Base.call(this, a, b); this.c = 3; } P.prototype = Object.create(Base.prototype); return P; }))(1, 2)));
out.push(show(() => new (pass(Shape, created))(2)));
const Built = pass(Shape, (Base) => { function Built(n) { const self = Reflect.construct(Base, [n], new.target); self.extra = 1; return self; } Built.prototype = Object.create(Base.prototype); Built.prototype.constructor = Built; return Built; });
for (let i = 0; i < 20; i++) new Built(i);
const built = new Built(3); out.push(JSON.stringify(built), built.area(), built instanceof Shape, built instanceof Built);
const Emitter = pass(require("events"), (Base) => { function E() { Base.call(this); this.n = 0; } Object.setPrototypeOf(E.prototype, Base.prototype); return E; });
const emitter = new Emitter(); emitter.on("a", function (v) { this.n += v; }); emitter.emit("a", 4); emitter.emit("a", 5); out.push(emitter.n);
const Failing = pass(Error, (Base) => { function F(m) { const e = Base.call(this, m); this.message = m; this.extra = e instanceof Error; } F.prototype = Object.create(Base.prototype); F.prototype.constructor = F; return F; });
const failing = new Failing("no"); out.push(String(failing), failing.extra, failing instanceof Error, Object.prototype.toString.call(failing));
// the prototype objects change later
const Changing = pass(Cursor, created), first = new Changing("a b c");
Changing.prototype.step = function () { this.pos += 2; return 100; }; out.push(first.all(), new Changing("a b c").all());
Cursor.prototype.kind = function () { return "changed"; }; out.push(first.kind(), new classes.late(text, true).kind());
Object.setPrototypeOf(Changing.prototype, Pair.prototype); out.push(show(() => first.all()), show(() => first.sum()), new Changing("z") instanceof Cursor, JSON.stringify(new Changing("z")));
Changing.prototype = Object.create(Cursor.prototype); out.push(new Changing("a b c").all(), new Changing("q") instanceof Cursor);
// a setter and a read-only value above a field of the parent
const Guarded = pass(Cursor, created); Object.defineProperty(Guarded.prototype, "type", { set(v) { out.push("type set " + v); }, get() { return "guarded"; }, configurable: true });
const guarded = new Guarded("a b"); out.push(guarded.type, Object.keys(guarded).join(), guarded.all());
const Closed = pass(Cursor, created); Object.defineProperty(Closed.prototype, "value", { value: 1, writable: false }); out.push(show(() => new Closed("a")));
for (const line of out) console.log(line);
