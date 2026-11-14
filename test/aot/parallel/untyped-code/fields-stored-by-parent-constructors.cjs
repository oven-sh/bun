// Constructor functions whose parents store their fields: on every way, on some ways, behind a return, in an object that the parent returns instead.
"use strict";
const out = [];
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
function link(heir, base) { heir.prototype = Object.create(base.prototype); heir.prototype.constructor = heir; heir.__proto__ = base; }
class Inner { constructor(n) { this.n = n; this.kind = "inner"; } }
var forms = {
  always: function () { function Base(n) { this.state = new Inner(n); this.name = "base"; } return Base; },
  some: function () { function Base(n) { if (n > 1) this.state = new Inner(n); this.name = "base"; } return Base; },
  early: function () { function Base(n) { if (n > 1) return; this.state = new Inner(n); this.name = "base"; } return Base; },
  returns: function () { function Base(n) { if (n > 1) return { other: n }; this.state = new Inner(n); this.name = "base"; } return Base; },
  alias: function () { function Root(n) { this.root = n; } function Base(n) { var _this; _this = Root.call(this, n) || this; _this.state = new Inner(n); _this.name = "base"; return _this; } link(Base, Root); return Base; },
  swapped: function () { function Root(n) { this.root = n; if (n > 1) return { swapped: n }; } function Base(n) { var _this; _this = Root.call(this, n) || this; _this.state = new Inner(n); _this.name = "base"; return _this; } link(Base, Root); return Base; },
  throws: function () { function Base(n) { if (n > 1) throw new RangeError("n"); this.state = new Inner(n); this.name = "base"; } return Base; },
  late: function () { function Base(n) { this.name = "base"; } Base.prototype.fill = function (n) { this.state = new Inner(n); }; return Base; },
};
function use(o) { return show(function () { var sum = ""; for (var i = 0; i < 3; i++) { sum += o.state.n + o.state.kind + o.name + o.late; o.state = o.state; } return sum + ("state" in o) + Object.keys(o); }); }
const heirs = [
  function (Base) { function Heir(n) { return Base.apply(this, arguments) || this; } link(Heir, Base); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
  function (Base) { function Heir(n) { Base.call(this, n); this.late = n; } link(Heir, Base); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
  function (Base) { function Heir(n) { if (n & 1) Base.call(this, n); this.late = n; } link(Heir, Base); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
  function (Base) { function Heir(n) { var _this; _this = Base.call(this, n) || this; _this.late = n; return _this; } link(Heir, Base); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
  function (Base) { function Heir(n) { n && Base.call(this, n); this.late = n; } link(Heir, Base); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
  function (Base) { function Middle(n) { return Base.call(this, n), undefined; } link(Middle, Base); function Heir(n) { Middle.call(this, n); this.late = n; } link(Heir, Middle); Heir.prototype.read = function () { return this.state.n + this.name; }; Heir.prototype.put = function (s) { this.state = s; }; return Heir; },
];
// The same, written out: what the compiler follows by name.
function Root(n) { this.root = n; }
function Base(n) { var _this; _this = Root.call(this, n) || this; _this.state = new Inner(n); _this.name = "base"; return _this; } link(Base, Root);
function Leaves(n) { if (n > 1) return { other: n }; this.state = new Inner(n); this.name = "leaves"; }
function Some(n) { if (n > 1) { this.state = new Inner(n); } this.name = "some"; }
function Plain(n) { return Base.apply(this, arguments) || this; } link(Plain, Base);
function Lower(n) { var _this; _this = Plain.call(this, n) || this; _this.late = n; return _this; } link(Lower, Plain);
function Drops(n) { Leaves.call(this, n); this.late = n; } link(Drops, Leaves);
function Takes(n) { return Leaves.call(this, n) || this; } link(Takes, Leaves);
function Maybe(n) { if (n & 1) Base.call(this, n); this.late = n; } link(Maybe, Base);
function OfSome(n) { Some.call(this, n); this.late = n; } link(OfSome, Some);
for (const C of [Plain, Lower, Drops, Takes, Maybe, OfSome]) { C.prototype.read = function () { return this.state.n + this.name; }; C.prototype.put = function (s) { this.state = s; }; }
Plain.prototype.look = function () { var old = this.state; this.state = new Inner(9); var n = this.state.n + this.name; this.state = old; return n; };
Lower.prototype.turn = function (k) { var sum = 0; for (var i = 0; i < k; i++) { sum += this.state.n; this.state.n = sum; } return sum + this.state.kind + this.name; };
const states = [() => new Inner(4), () => null, () => undefined, () => ({ n: 1, kind: 2 }), () => 7, () => new Proxy(new Inner(5), {}), () => Object.freeze(new Inner(6))];
function drive(title, C) {
  for (let n = 0; n < 4; n++) {
    let o; out.push(title + n + show(() => { o = new C(n); return Object.keys(o); }));
    if (!o) continue;
    out.push(use(o), show(() => o.read()), show(() => o.look && o.look()), show(() => o.turn && o.turn(3)));
    for (const state of states) { out.push(show(() => { o.put(state()); return o.read(); }), show(() => o.turn && o.turn(2))); }
    out.push(show(() => { delete o.state; return o.read(); }), show(() => { C.prototype.state = new Inner(8); try { return o.read(); } finally { delete C.prototype.state; } }));
    out.push(show(() => { const q = Object.create(C.prototype); return q.read(); }), show(() => { const q = Object.create(C.prototype); q.name = "q"; q.put(new Inner(3)); return q.read(); }), show(() => Reflect.construct(C, [n], Inner).state.n), show(() => structuredClone({ ...o }).name));
  }
}
for (const [title, C] of Object.entries({ Plain, Lower, Drops, Takes, Maybe, OfSome })) for (let round = 0; round < 2; round++) drive(title, C);
for (const form of Object.keys(forms)) for (let h = 0; h < heirs.length; h++) drive(form + h, heirs[h](forms[form]()));
for (const line of out) console.log(line);
