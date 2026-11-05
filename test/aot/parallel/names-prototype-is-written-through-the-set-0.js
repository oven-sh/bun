function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function first(x) { return "1" + typeof x + (x + 1); }
function second(x) { return "2" + typeof x + (x + 2); }
function third(x) { return "3" + typeof x + (x + 3); }
function fourth(x) { return "4" + typeof x + (x + 4); }
function fifth(x) { return "5" + typeof x + (x + 5); }
function pick(c) { return c & 1 ? first : second; }
var said = [];
for (var i = 0; i < 8; i++) said.push(pick(i)(i));
var c = said.length > 100 ? 1 : 0;
(c ? first : second).prototype = { m: function () { return "laid"; } }; said.push(tell(function () { return new first(1).m(); }), tell(function () { return new second(1).m(); }));
for (var i = 0; i < 4; i++) said.push(pick(i)(i));
console.log(said.join("|"));
