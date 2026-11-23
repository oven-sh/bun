// Bundles of webpack that are written in functions: of one that runs once, and of others.
const out = [];
const tell = (f) => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name + ": " + (e.message || "").slice(0, 12)); } };
var first;
(function () {
  (() => { var e = { 1: (e, t, n) => { "use strict"; n.r(t), n.d(t, { Point: () => Point, add: () => add }); var m = n(2); class Point { constructor(x) { this.x = x; } twice() { return m.two(this.x); } } function add(a, b) { return new Point(a.x + b.x); } }, 2: (e, t) => { t.two = function (x) { return 2 * x; }; e.exports.count = 0; }, 3: () => {} }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } n.d = (e, t) => { for (var r in t) n.o(t, r) && !n.o(e, r) && Object.defineProperty(e, r, { enumerable: !0, get: t[r] }) }, n.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t), n.r = e => { "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 }) }; var r = {}; (() => { "use strict"; n.r(r), n.d(r, { run: () => run }); var e = n(1); function run(m) { let p = new e.Point(0); for (let i = 0; i < m; i++) p = e.add(p, new e.Point(i)); return p.twice(); } })(), first = r })();
})();
tell(() => [first.run(10), first.run(100), Object.keys(first), first.run.name]);
// two functions around it, and what they hold
var second;
(() => { var outer = 5; (function (hidden) { var inner = { n: 1 };
  (() => { var e = { 1: (e, t, n) => { e.exports = function (x) { return x + 1; }; }, 2: (e, t, n) => { var f = n(1); t.go = function (x) { return f(f(x)); }; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } second = n(2) })();
  outer += inner.n; })(); out.push(outer); })();
tell(() => [second.go(1), second.go(5)]);
// the bodies name what lies around them
var third;
(function () { var base = 10, calls = 0;
  (() => { var e = { 1: (e, t, n) => { e.exports = function (x) { calls++; return x + base; }; }, 2: (e, t, n) => { t.go = n(1), t.calls = () => calls; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } third = n(2) })();
  base = 20; })();
tell(() => [third.go(1), third.go(5), third.calls()]);
var fourth;
(function (module, exports, require) {
  (() => { var e = { 1: (e, t, n) => { e.exports = [typeof module, typeof exports, typeof require]; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } fourth = n(1) })();
})();
tell(() => fourth);
// functions that run again, later, never, in parts
function again(v) { var made;
  (() => { var e = { 1: (e, t, n) => { class Kept { constructor() { this.v = Kept.made++; } } Kept.made = 0; e.exports = Kept; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } made = n(1) })();
  return made; }
tell(() => { const a = again(), b = again(); return [a === b, new a().v, new a().v, new b().v, new a() instanceof b]; });
const kept = [];
for (let i = 0; i < 3; i++) (() => { (() => { var e = { 1: (e, t, n) => { e.exports = class Turn { static id = i; }; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } kept.push(n(1)) })(); })();
tell(() => [kept[0] === kept[1], kept.map((k) => k.id)]);
const steps = (function* () { (() => { var e = { 1: (e, t, n) => { t.at = "generator"; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } out.push(n(1).at) })(); yield 1; })();
tell(() => [steps.next().value, steps.next().done]);
(function self(depth) { if (depth) return self(depth - 1);
  (() => { var e = { 1: (e, t, n) => { t.depth = 0; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } out.push("depth " + n(1).depth) })(); })(2);
// a body that throws, then again
var failing;
(() => { (() => { var tries = 0, e = { 1: (e, t, n) => { t.before = 1; if (!globalThis.ready) throw new TypeError("not ready"); t.after = 2; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } failing = n })(); })();
tell(() => failing(1)); tell(() => Object.keys(failing(1)));
// UMD around it
(function (root, factory) { if (typeof root.define === "function") root.define([], factory); else root.umd = factory(); })(globalThis, () => { return (() => { var e = { 1: (e, t, n) => { e.exports = class U { m() { return "umd"; } }; } }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } return n(1); })(); });
tell(() => new umd().m());
console.log(out.join("\n"));
