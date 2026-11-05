function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function one(i) { return { a: i, b: 2 }; }
function two(i) { return { b: "s" + i, c: 3 }; }
function three(i) { return { c: 1.5, a: "x", d: i }; }
function four(i) { return {}; }
function five(i) { return { e: i, a: null }; }
var K = 4;
function spoil(o, i) { return o; }
function other(o) { if (o.d === 5) o.a = "changed"; }
function deed(o, i) { var was = delete o.a; return was + JSON.stringify(o) + String(o.a); }
function pick(i) { var o = i % 4 === 0 ? spoil(one(i), i) : i % 4 === 1 ? two(i) : i % 4 === 2 ? three(i) : i % 4 === 3 ? four(i) : five(i); return deed(o, i); }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
