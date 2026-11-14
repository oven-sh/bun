// Constructor functions without fields, whose objects an initializer on the prototype fills: read before it, behind it, half filled, deleted, copied by key, filled by others.
"use strict";
const out = [];
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
class Place { constructor(line) { this.line = line; } }
var State = function () {
  function State() {}
  var proto = State.prototype;
  proto.init = function (input, n) { this.input = input; this.pos = this.lineStart = 0; this.line = n; this.type = "none"; this.value = null; this.place = this.here(); this.list = [1, 2]; this.flag = false; if (n > 5) return; this.rest = n; this.last = this.place; };
  proto.here = function () { return new Place(this.line); };
  proto.copy = function () { var _this = this; var state = new State(); Object.keys(this).forEach(function (key) { var v = _this[key]; state[key] = Array.isArray(v) ? v.slice() : v; }); return state; };
  proto.scan = function () { var sum = 0; while (this.pos < this.input.length) { sum += this.input.charCodeAt(this.pos); this.pos += 1; if (sum & 64) { this.flag = !this.flag; this.line += 1; } } return sum + this.line + this.type + this.list.length; };
  proto.touch = function () { this.type = "touched"; this.value = this.pos; this.place = this.last; return this.type + this.value + this.flag + (this.place && this.place.line) + this.rest; };
  return State;
}();
function Holder(n) { this.state = new State(); if (n) this.state.init("text" + n, n); }
Holder.prototype.step = function (k) { var s = ""; for (var i = 0; i < k; i++) { s += this.state.type + this.state.pos + this.state.list[i]; this.state.pos = this.state.pos + 1; this.state.start = this.state.pos; } return s + this.state.start; };
Holder.prototype.look = function () { var old = this.state; this.state = old.copy(); var r = this.step(2); this.state = old; return r + this.step(1); };
const states = [(s) => s, (s) => new State(), (s) => { const t = new State(); t.pos = 1; t.input = "ab"; return t; }, (s) => { delete s.pos; return s; }, (s) => { delete s.type; delete s.list; return s; }, (s) => s.copy(), (s) => Object.assign(new State(), { pos: 1.5, input: "xyz", list: [] }), (s) => Object.freeze(s), (s) => Object.preventExtensions(new State()),
  (s) => Object.defineProperty(s, "pos", { get() { return 2; }, configurable: true }), (s) => Object.create(s), (s) => new Proxy(s, {}), (s) => ({ input: "plain", pos: 0, scan: State.prototype.scan, touch: State.prototype.touch, copy: State.prototype.copy }), (s) => null, (s) => Object.setPrototypeOf(s, { scan: State.prototype.scan }), (s) => { for (const k of Object.keys(s)) s[k] = undefined; return s; }, (s) => { s.init("again", 9); return s; }, (s) => { const t = new State(); t.init("late", 9); return t; }];
function drive(round) {
  for (let n = 0; n < 7; n += 2) for (let k = 0; k < states.length; k++) {
    const h = new Holder(n);
    out.push(round + "" + n + k + show(() => h.state.scan()), show(() => h.state.touch()), show(() => h.step(2)), show(() => h.look()));
    out.push(show(() => { h.state = states[k](h.state); return Object.keys(h.state).length; }), show(() => h.state.scan()), show(() => h.state.touch()), show(() => h.step(3)), show(() => h.look()), show(() => JSON.stringify(h.state)));
  }
}
for (let round = 0; round < 2; round++) drive(round);
State.prototype.pos = 3; State.prototype.type = "above"; State.prototype.rest = "rest";
drive(2);
Object.defineProperty(State.prototype, "list", { get() { return [this.line]; }, set(v) { this.kept = v; }, configurable: true });
drive(3);
for (const line of out) console.log(line);
