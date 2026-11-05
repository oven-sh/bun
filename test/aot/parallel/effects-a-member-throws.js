function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
var box = { n: 1 }, list = [], count = 0;
function Kind() {}
function does(x) { if (x > 4) throw new RangeError("r"); return x; }
function doesNot(x) { return x; }
function pick(c) { return c & 1 ? does : doesNot; }
function run(c) { return tell(function () { pick(c)(5); return "came back"; }); }
var said = [];
for (var i = 0; i < 8; i++) said.push(run(i));
console.log(said.join("|"));
