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
function take(o, i) { o = o || four(i); return deed(o, i); }
function pick(i) { switch (i % 4) { case 0: return take(spoil(one(i), i), i); case 1: return take(two(i), i); case 2: return take(three(i), i); case 3: return take(undefined, i); default: return take(five(i), i); } }
var said = [];
for (var i = 0; i < 24; i++) said.push(tell(function () { return pick(i); }));
console.log(said.join("|"));
