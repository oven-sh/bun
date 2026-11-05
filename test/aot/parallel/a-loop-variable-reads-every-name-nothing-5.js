function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function one(i) { return { a: i, b: 2 }; }
function two(i) { return { b: "s" + i, c: 3 }; }
function three(i) { return { c: 1.5, a: "x", d: i }; }
function four(i) { return {}; }
function five(i) { return { e: i, a: null }; }
var K = 5;
function spoil(o, i) { return o; }
function other(o) { if (o.d === 5) o.a = "changed"; }
function deed(o, i) { return typeof o.a + o.a + typeof o.b + o.b + typeof o.c + o.c + typeof o.d + o.d; }
function pick(i) { var o = spoil(one(i), i); for (var k = 0; k < i % 5; k++) o = k === 0 ? two(i) : k === 1 ? three(i) : k === 2 ? four(i) : five(i); return deed(o, i); }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
