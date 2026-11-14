// One caller in sight passes objects of one class; the others pass objects of any kind, most of them of the other classes that have every name.
// STATISTIC: GuessesWithOtherClasses >= 1
"use strict";
(function (module, exports, require, define) { (function () {
!function (t, n) { "object" == typeof exports && "undefined" != typeof module ? n(exports) : "function" == typeof define && define.amd ? define(["exports"], n) : n((t = t || self).kinds = {}); }(this, (function (T) {
  var State = function () { this.tracking = null; this.context = false; this.batch = 0; this.run = 0; this.version = 6; };
  var state = function () { var g = globalThis; return g.__count > 0 && !g.__st && (g.bad = !0), g.__st ? (g.__count += 1, g.__st) : (g.__count = 1, g.__st = new State); }();
  var extend = function (t, n) { t.prototype = Object.create(n.prototype), t.prototype.constructor = t, (Object.setPrototypeOf || function (t, n) { return t.__proto__ = n, t; })(t, n); };
  function report(t) { var n = state.tracking; return null !== n ? (n.mark !== t.seen && (t.seen = n.mark, n.list[n.count++] = t, !t.active && state.context && (t.active = !0, t.begin())), !0) : (0 === t.watchers.size && state.batch > 0 && drop(t), !1); }
  function drop(t) { !1 === t.waits && (t.waits = !0); }
  var Atom = function () {
    function t(t) { void 0 === t && (t = "Atom"), this.name = void 0, this.waits = !1, this.active = !1, this.watchers = new Set, this.seen = 0, this.begun = 0, this.name = t; }
    var n = t.prototype;
    return n.begin = function () { this.begun++; }, n.report = function () { return report(this); }, n.toString = function () { return this.name; }, t;
  }();
  var Value = function (t) {
    function n(n, i) { var o; return void 0 === i && (i = "Value"), (o = t.call(this, i) || this).extra = void 0, o.value = void 0, o.value = n, o; }
    extend(n, t);
    var i = n.prototype;
    return i.get = function () { return this.report(), this.value; }, n;
  }(Atom);
  var Computed = function () {
    function t(t) { this.state = -1, this.list = [], this.active = !1, this.waits = !1, this.watchers = new Set, this.mark = 0, this.seen = 0, this.count = 0, this.value = t, this.begun = 0; }
    var i = t.prototype;
    return i.begin = function () { this.begun += 2; }, i.get = function () { return report(this), this.value; }, t;
  }();
  T.Value = Value; T.Atom = Atom; T.Computed = Computed; T.state = state; T.report = report; T.isAtom = function (t) { return t instanceof Atom; };
  Object.defineProperty(T, "__esModule", { value: !0 });
}));
const { Value, Atom, Computed, state, report, isAtom } = globalThis.kinds;
const strangers = [
  () => ({ seen: 0, active: false, watchers: new Set(), waits: false, begin() { this.begun = "literal"; } }), () => Object.assign(Object.create(null), { seen: "s", active: 1, watchers: new Map(), begin() {} }),
  () => Object.create(new Atom("above")), () => new (class extends Value { seen = 0.5; get active() { return false; } set active(value) { this.kept = value; } })(1),
  () => new Proxy(new Value(2), {}), () => Object.freeze(new Atom("frozen")), () => [1], () => function named() {}, () => null, () => 7,
];
const log = [], values = [];
for (let k = 0; k < 40; k++) values.push(k % 3 ? new Value(k) : k % 2 ? new Atom("a" + k) : new Computed(k));
const attempt = (action) => { try { return String(action()); } catch (error) { return error.name; } };
for (let turn = 0; turn < 400; turn++) {
  const derivation = new Computed(turn);
  derivation.list = new Array(64); derivation.mark = ++state.run; state.tracking = turn % 5 ? derivation : null; state.context = turn % 2 === 0; state.batch = turn % 3;
  let total = 0;
  for (const value of values) total += value.get ? value.get() : value.report() ? 1 : 0;
  const more = turn % 20 ? "" : strangers.map((make) => attempt(() => { const made = make(); return report(made) + " " + made.seen + " " + made.active + " " + made.begun + " " + made.waits; })).join();
  if (turn % 10 === 0) log.push(total + " " + derivation.count + " " + derivation.list.length + " " + values.map((value) => value.seen + (value.active ? "a" : "") + (value.waits ? "w" : "") + value.begun).join("|") + more);
  if (turn === 150) delete values[4].active;
  if (turn === 200) Object.defineProperty(values[5], "seen", { get: () => "accessor", set(value) { this.kept = value; }, configurable: true });
  if (turn === 250) values[7].begin = function () { this.begun = "own"; };
  if (turn === 300) values[8].seen = "text";
}
state.tracking = null;
log.push(String(isAtom(values[0])) + isAtom(values[1]));
console.log(log.length);
console.log(log.join("\n"));
}).call(globalThis); })();
