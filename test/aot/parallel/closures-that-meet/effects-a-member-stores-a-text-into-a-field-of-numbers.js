function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
var box = { n: 1 }, list = [], count = 0;
function Kind() {}
function does(x) { box.n = "t" + x; return x; }
function doesNot(x) { return x; }
function pick(c) { return c & 1 ? does : doesNot; }
function run(c) { var before = box.n; pick(c)(5); return typeof before + ":" + typeof box.n + ":" + box.n; }
var said = [];
for (var i = 0; i < 8; i++) said.push(run(i));
console.log(said.join("|"));
