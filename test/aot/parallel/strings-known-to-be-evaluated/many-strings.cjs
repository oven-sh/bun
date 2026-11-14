// Many strings at one place, long strings, long concatenations, strings in loops that the build follows only so far.
const say = (...a) => console.log(...a);
const names = []; for (let i = 0; i < 60; i++) names.push("f" + i);
const made = {};
for (const n of names) made[n] = eval("(function " + n + "(x) { return x + " + n.slice(1) + "; })");
let sum = 0; for (const n of names) sum += made[n](1); say(sum, made.f59.toString());
let long = "(function long(x) {"; for (let i = 0; i < 300; i++) long += " x += " + i + ";"; long += " return x; })";
say(eval(long)(1), long.length);
let grown = "x"; for (let i = 0; i < 200; i++) grown = "(" + grown + " + 1)";
say(eval("(function (x) { return " + grown + "; })")(1));
for (let i = 0; i < 3000; i++) { const f = eval("(function () { return " + i + "; })"); if (i % 1000 === 999) say(f()); }
const unknown = process.argv.length;
const t = unknown > 90 ? "(function () { return 'many'; })" : "(function () { return 'few'; })"; say(eval(t)());
let w = ""; while (w.length < 5) w += "a"; say(eval("(function () { return '" + w + "'; })")());
let forever = 0; function never() { while (true) { if (forever++ > 5) return "(function () { return 'out'; })"; } } say(eval(never())());
function deep(n) { return n ? deep(n - 1) + " + " + n : "0"; } say(eval("(function () { return " + deep(100) + "; })")());
say(eval("(function () { return " + "1 + ".repeat(500) + "1; })")());
