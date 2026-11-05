function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function first(x) { return "1" + typeof x + (x + 1); }
function second(x) { return "2" + typeof x + (x + 2); }
function third(x) { return "3" + typeof x + (x + 3); }
function fourth(x) { return "4" + typeof x + (x + 4); }
function fifth(x) { return "5" + typeof x + (x + 5); }
var made = []; for (let k = 0; k < 2; k++) made.push(k ? x => "a" + typeof x + (x + k) : x => "b" + typeof x + (x - k));
function pick(c) { return made[c & 1]; }
var said = [];
for (var i = 0; i < 8; i++) said.push(pick(i)(i));
for (var n = 0; n < 4; n++) said.push(tell(function () { return pick(n).call(null, "t"); }), tell(function () { return ["u"].map(pick(n))[0]; }));
console.log(said.join("|"));
