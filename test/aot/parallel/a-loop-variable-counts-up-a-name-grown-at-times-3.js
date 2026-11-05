function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function one(i) { return { a: i, b: 2 }; }
function two(i) { return { b: "s" + i, c: 3 }; }
function three(i) { return { c: 1.5, a: "x", d: i }; }
function four(i) { return {}; }
function five(i) { return { e: i, a: null }; }
var K = 3;
function spoil(o, i) { if (i % 3 === 0) { o.c = "more"; o.zz = i; } return o; }
function other(o) { if (o.d === 5) o.a = "changed"; }
function deed(o, i) { o.b++; o.c += 1; return String(o.b) + String(o.c) + Object.keys(o).join(); }
function pick(i) { var o = spoil(one(i), i); for (var k = 0; k < i % 3; k++) o = k === 0 ? two(i) : k === 1 ? three(i) : k === 2 ? four(i) : five(i); return deed(o, i); }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
