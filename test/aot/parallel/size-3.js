function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function first(x) { return "1" + typeof x + (x + 1); }
function second(x) { return "2" + typeof x + (x + 2); }
function third(x) { return "3" + typeof x + (x + 3); }
function fourth(x) { return "4" + typeof x + (x + 4); }
function fifth(x) { return "5" + typeof x + (x + 5); }
var all = [first, second, third];
function pick(c) { return all[c % 3]; }
var said = [];
for (var i = 0; i < 12; i++) said.push(pick(i)(i));
for (var n = 0; n < 3; n++) said.push(tell(function () { return pick(n).apply(null, ["t"]); }));
console.log(said.join("|"));
