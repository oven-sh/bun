// A constructor function that many kinds of objects call on themselves creates the same fields in each. Every object lists its
// names in the order in which they were created, whichever kind came to the constructor before it.
function Base(options) {
  if (this.first === undefined) this.first = options;
  this.second ??= 2;
  if (options & 1) this.odd = true;
  this.third = options ? 3 : 4;
  if (options % 3 === 0) { this.fourth = 4; this.fifth = 5; this.sixth = 6; }
}
Base.prototype.sum = function () { return this.second + this.third; };
const kinds = [];
const failures = [];
function kind(body) { Object.setPrototypeOf(body.prototype, Base.prototype); kinds.push(body); }
kind(function A(o) { this.a = 1; Base.call(this, o); });
kind(function B(o) { this.b = 1; this.c = 2; Base.call(this, o); });
kind(function C(o) { Base.call(this, o); this.d = 2; });
kind(function D(o) { this.third = 0; Base.call(this, o); });
kind(function E(o) { this.second = 9; this.first = 8; Base.call(this, o); });
kind(function F(o) { if (o & 2) this.early = o; Base.call(this, o); if (o & 4) this.late = o; });
kind(function G(o) { this.sixth = 0; this.fourth = 0; Base.call(this, o); });
kind(function H(o) { Base.call(this, o); Base.call(this, o + 1); });
kind(function I(o) { this["x" + (o & 3)] = o; Base.call(this, o); });
kind(function J(o) { Base.call(this, o); delete this.second; Base.call(this, o); });
kind(function K(o) { if (o & 8) Object.preventExtensions(this); try { Base.call(this, o); } catch (error) { failures.push(error.constructor.name); } });
kind(function L(o) { Object.defineProperty(this, "second", { value: 7, enumerable: false, writable: true, configurable: true }); Base.call(this, o); });
class M extends Base { m = 1; constructor(o) { super(o); this.n = 2; } }
class N extends M { before = 0; constructor(o) { super(o); this.after = 1; } }
kinds.push(M, N);

const seen = new Map();
function note(object, name, o) {
  const text = name + " " + (o % 24) + ": " + Object.keys(object).join() + " | " + JSON.stringify(object) + " | " + object.sum();
  const key = name + " " + (o % 24);
  if (!seen.has(key)) seen.set(key, text);
  else if (seen.get(key) !== text) console.log("CHANGED", seen.get(key), "=>", text);
}
for (let round = 0; round < 60; round++) {
  // In turn, in runs of one kind, backwards, and by a stride that never repeats the neighbour.
  for (let i = 0; i < kinds.length * 24; i++) {
    const at = round % 4 === 0 ? i % kinds.length : round % 4 === 1 ? Math.floor(i / 24) : round % 4 === 2 ? kinds.length - 1 - (i % kinds.length) : (i * 5) % kinds.length;
    const o = round % 4 === 1 ? i % 24 : Math.floor(i / kinds.length) % 24;
    note(new kinds[at](o), kinds[at].name, o);
  }
}
for (const text of [...seen.values()].sort()) console.log(text);
console.log(failures.length, [...new Set(failures)].join());
