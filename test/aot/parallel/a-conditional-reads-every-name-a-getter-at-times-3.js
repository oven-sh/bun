function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function one(i) { return { a: i, b: 2 }; }
function two(i) { return { b: "s" + i, c: 3 }; }
function three(i) { return { c: 1.5, a: "x", d: i }; }
function four(i) { return {}; }
function five(i) { return { e: i, a: null }; }
var K = 3;
function spoil(o, i) { return i % 3 === 0 ? Object.defineProperty(o, "a", { get: function () { return "got"; }, set: function (v) { this.b = "set" + v; }, enumerable: true, configurable: true }) : o; }
function other(o) { if (o.d === 5) o.a = "changed"; }
function deed(o, i) { return typeof o.a + o.a + typeof o.b + o.b + typeof o.c + o.c + typeof o.d + o.d; }
function pick(i) { var o = i % 3 === 0 ? spoil(one(i), i) : i % 3 === 1 ? two(i) : i % 3 === 2 ? three(i) : i % 3 === 3 ? four(i) : five(i); return deed(o, i); }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
