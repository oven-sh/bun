// Constructor functions without fields, whose objects an initializer on the prototype fills: read before it, behind it, half filled, deleted, copied by key, filled by others.
"use strict";
const out = [];
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
class Shelf { constructor(heat) { this.heat = heat; } }
var Kettle = function () {
  function Kettle() {}
  var below = Kettle.prototype;
  below.filled = function (water, n) { this.flag = false; this.list = [1, 2]; this.heat = n; this.shelf = this.set(); this.spout = 0; this.level = 0; this.metal = "none"; this.weight = null; this.water = water; if (n > 5) return; this.last = this.shelf; this.rest = n; };
  below.set = function () { return new Shelf(this.heat); };
  below.cast = function () { var made = Object.assign(new Kettle(), this); if (made.list instanceof Array) made.list = [].concat(made.list); return made; };
  below.poured = function () { var sum = 0; while (this.level < this.water.length) { sum += this.water.charCodeAt(this.level); this.level += 1; if (sum & 64) { this.flag = !this.flag; this.heat += 1; } } return sum + this.heat + this.metal + this.list.length; };
  below.touched = function () { this.metal = "warm"; this.weight = this.level; this.shelf = this.last; return this.metal + this.weight + this.flag + (this.shelf && this.shelf.heat) + this.rest; };
  return Kettle;
}();
function Holder(n) { this.kettle = new Kettle(); if (n) this.kettle.filled("text" + n, n); }
Holder.prototype.step = function (k) { var s = ""; for (var i = 0; i < k; i++) { s += this.kettle.metal + this.kettle.level + this.kettle.list[i]; this.kettle.level = this.kettle.level + 1; this.kettle.since = this.kettle.level; } return s + this.kettle.since; };
Holder.prototype.look = function () { var old = this.kettle; this.kettle = old.cast(); var r = this.step(2); this.kettle = old; return r + this.step(1); };
const kettles = [(s) => s, (s) => new Kettle(), (s) => { const t = new Kettle(); t.level = 1; t.water = "ab"; return t; }, (s) => { delete s.level; return s; }, (s) => { delete s.metal; delete s.list; return s; }, (s) => s.cast(), (s) => Object.assign(new Kettle(), { level: 1.5, water: "xyz", list: [] }), (s) => Object.freeze(s), (s) => Object.preventExtensions(new Kettle()),
  (s) => Object.defineProperty(s, "level", { get() { return 2; }, configurable: true }), (s) => Object.create(s), (s) => new Proxy(s, {}), (s) => ({ water: "plain", level: 0, poured: Kettle.prototype.poured, touched: Kettle.prototype.touched, cast: Kettle.prototype.cast }), (s) => null, (s) => Object.setPrototypeOf(s, { poured: Kettle.prototype.poured }), (s) => { for (const k of Object.keys(s)) s[k] = undefined; return s; }, (s) => { s.filled("again", 9); return s; }, (s) => { const t = new Kettle(); t.filled("late", 9); return t; }];
function drive(round) {
  for (let n = 0; n < 7; n += 2) for (let k = 0; k < kettles.length; k++) {
    const h = new Holder(n);
    out.push(round + "" + n + k + show(() => h.kettle.poured()), show(() => h.kettle.touched()), show(() => h.step(2)), show(() => h.look()));
    out.push(show(() => { h.kettle = kettles[k](h.kettle); return Object.keys(h.kettle).length; }), show(() => h.kettle.poured()), show(() => h.kettle.touched()), show(() => h.step(3)), show(() => h.look()), show(() => JSON.stringify(h.kettle)));
  }
}
for (let round = 0; round < 2; round++) drive(round);
Kettle.prototype.level = 3; Kettle.prototype.metal = "above"; Kettle.prototype.rest = "rest";
drive(2);
Object.defineProperty(Kettle.prototype, "list", { get() { return [this.heat]; }, set(v) { this.kept = v; }, configurable: true });
drive(3);
for (const line of out) console.log(line);
