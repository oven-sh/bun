// STATISTIC: ClosedPrototypeObjects >= 7
// A function that is called where it is written holds the prototypes, or a prototype is made below another one.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name + ": " + e.message; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function hot(make, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = make(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
var lib = (function () {
  "use strict";
  var proto = { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } };
  function make(a, b) { var o = Object.create(proto); o.a = a; o.b = b; o.next = null; return o; }
  return { make: make, above: proto, literal: (a) => ({ __proto__: proto, a: a, b: 0, next: null }) };
})();
tell("wrapped", () => [hot(lib.make, 3000), hot(lib.literal, 100), Object.getPrototypeOf(lib.make(1, 2)) === lib.above, Object.keys(lib.make(1, 2))]);
tell("wrapped replaced", () => { const c = lib.make(3, 4), before = c.sum(); lib.above.sum = function () { return "replaced"; }; return [before, c.sum(), lib.make(5, 6).sum()]; });
// This one is called twice: each call has prototypes of its own.
function wrap(n) { var proto = { get: function () { return n + this.a; } }; return function make(a) { var o = Object.create(proto); o.a = a; return o; }; }
const ones = wrap(100), twos = wrap(200);
tell("called twice", () => [ones(1).get(), twos(1).get(), ones(2).get(), Object.getPrototypeOf(ones(1)) === Object.getPrototypeOf(ones(2)), Object.getPrototypeOf(ones(1)) === Object.getPrototypeOf(twos(1))]);
const made = []; for (var i = 0; i < 2; i++) made.push((function () { var proto = { get: function () { return this.a * 10 + mark; } }, mark = i; return function (a) { var o = Object.create(proto); o.a = a; return o; }; })());
tell("in a loop", () => [made[0](1).get(), made[1](1).get(), Object.getPrototypeOf(made[0](1)) === Object.getPrototypeOf(made[1](1))]);
var again = 0; var itself = (function f(n) { var proto = { get: function () { return n; } }; again++; var o = Object.create(proto); o.a = n; return n ? [o].concat(f(n - 1)) : [o]; })(2);
tell("itself", () => [again, itself.map((o) => o.get()), Object.getPrototypeOf(itself[0]) === Object.getPrototypeOf(itself[1])]);
// Prototypes below others.
const base = { name() { return "base " + this.a; }, kind: "base", get twice() { return this.a * 2; } };
const middle = Object.create(base); middle.name = function () { return "middle " + base.name.call(this); }; middle.own = function () { return this.b; };
const heir = Object.assign(Object.create(middle), { name() { return "heir " + middle.name.call(this); }, kind: "heir" });
function makeHeir(a, b) { const o = Object.create(heir); o.a = a; o.b = b; return o; }
function makeMiddle(a, b) { const o = Object.create(middle); o.a = a; o.b = b; return o; }
tell("heirs", () => [makeHeir(1, 2).name(), makeHeir(1, 2).own(), makeHeir(3, 4).kind, makeHeir(5, 6).twice, makeMiddle(1, 2).name(), makeMiddle(1, 2).kind, heir.name(), middle.name(), Object.create(base).name()]);
tell("above", () => [Object.getPrototypeOf(heir) === middle, Object.getPrototypeOf(middle) === base, base.isPrototypeOf(makeHeir(1, 2)), Object.keys(heir), Object.keys(middle), Object.hasOwn(heir, "own")]);
function total(make, n) { let t = 0; const list = [make(1, 2), make(3, 4)]; for (let k = 0; k < n; k++) { const c = list[k & 1]; t = (t + c.own() + c.twice) & 65535; c.b = k & 15; } return t; }
tell("hot heirs", () => [total(makeHeir, 500), total(makeMiddle, 500)]);
tell("replaced above", () => { const c = makeHeir(1, 2); const before = c.own(); middle.own = function () { return "own"; }; base.kind = "changed"; const after = c.own(); delete heir.kind; return [before, after, c.kind, makeHeir(1, 2).kind]; });
tell("moved above", () => { const c = makeHeir(7, 8); Object.setPrototypeOf(middle, { twice: "moved", extra: 1 }); return [c.twice, c.extra, c.kind, "name" in c, makeHeir(1, 2).extra]; });
// What the module exports is held twice.
var shared = module.exports = { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 255; return this; } };
function makeShared(a, b) { var o = Object.create(shared); o.a = a; o.b = b; o.next = null; return o; }
tell("exported", () => [hot(makeShared, 500), module.exports === shared, Object.keys(module.exports)]);
tell("exported replaced", () => { const c = makeShared(1, 2), before = c.sum(); module.exports.sum = () => "exported"; return [before, c.sum()]; });
tell("missing above", () => { const c = Object.create(late); c.a = 1; return c.get(); });
var lateAbove = { get() { return this.a; } };
var late = Object.create(lateAbove);
tell("late", () => { const c = Object.create(late); c.a = 2; return c.get(); });
console.log(out.join("\n"));
