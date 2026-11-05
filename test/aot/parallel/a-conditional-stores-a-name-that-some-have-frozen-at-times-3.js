function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function one(i) { return { a: i, b: 2 }; }
function two(i) { return { b: "s" + i, c: 3 }; }
function three(i) { return { c: 1.5, a: "x", d: i }; }
function four(i) { return {}; }
function five(i) { return { e: i, a: null }; }
var K = 3;
function spoil(o, i) { return i % 3 === 0 ? Object.freeze(o) : o; }
function other(o) { if (o.d === 5) o.a = "changed"; }
function deed(o, i) { o.b = i; return JSON.stringify(o) + Object.keys(o).join(); }
function pick(i) { var o = i % 3 === 0 ? spoil(one(i), i) : i % 3 === 1 ? two(i) : i % 3 === 2 ? three(i) : i % 3 === 3 ? four(i) : five(i); return deed(o, i); }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
