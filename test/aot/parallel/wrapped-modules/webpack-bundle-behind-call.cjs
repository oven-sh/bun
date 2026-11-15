// STATISTIC: AccessesUnknown <= 60
const out = [];
const tell = (f) => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
var first;
(function (module, exports, require, process) { (function () {
  (() => { var e = { 1: (e, t, n) => { "use strict"; n.r(t), n.d(t, { Point: () => Point, add: () => add, host: () => host }); var m = n(2); class Point { constructor(x) { this.x = x; } twice() { return m.two(this.x); } } function add(a, b) { return new Point(a.x + b.x); } var host = typeof process !== "undefined" && process.versions ? "node" : typeof require + typeof module; }, 2: (e, t) => { t.two = function (x) { return 2 * x; }; }, 3: () => {} }, t = {}; function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports } n.d = (e, t) => { for (var r in t) n.o(t, r) && !n.o(e, r) && Object.defineProperty(e, r, { enumerable: !0, get: t[r] }) }, n.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t), n.r = e => { "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 }) }; var r = {}; (() => { "use strict"; n.r(r), n.d(r, { run: () => run, host: () => e.host }); var e = n(1); function run(m) { let p = new e.Point(0); for (let i = 0; i < m; i++) p = e.add(p, new e.Point(i)); return p.twice(); } })(), first = r })();
}).call(globalThis); })();
tell(() => [first.run(10), first.run(100), Object.keys(first), first.run.name, first.host]);
tell(() => { let s = 0; for (let i = 0; i < 300; i++) s = s + first.run(i % 7) | 0; return s; });
console.log(out.join("\n"));
