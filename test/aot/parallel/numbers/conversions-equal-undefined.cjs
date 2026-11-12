// An integer or undefined and the number that it converts to: undefined converts to NaN, which equals nothing.
var out = [];
function say(v) { out.push(v === true ? "T" : v === false ? "F" : String(v)); }
function line(name) { console.log(name, out.join(" ")); out.length = 0; }

function plus() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(+x === x); say(x === +x); say(+x !== x); say(+x == x); say(+x != x); } }
function times() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(x * 1 === x); say(x - 0 === x); say(x / 1 === x); } }
function rounded() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(Math.floor(x) === x); say(Math.trunc(x) === x); say(Math.round(x) === x); say(Math.abs(x) === x); } }
function twice() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(+x === +x); say(+x === x * 1); say(+x !== +x); say(+x == +x); } }
function same() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(Object.is(+x, x)); say(Object.is(+x, +x)); say([+x].includes(x)); say([+x].includes(+x)); say([x].indexOf(+x)); say([+x].indexOf(+x)); } }
function branch() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; if (+x === x) say("equal"); else say("differ"); say(+x === x ? 1 : 2); while (+x !== x) { say("while"); break; } } }
function chosen() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; switch (+x) { case x: say("x"); break; default: say("none"); } switch (x) { case +x: say("x"); break; case undefined: say("undefined"); break; default: say("none"); } } }
function returned(x) { return +x === x; }
function returns() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(returned(x)); say((function () { return x * 1 !== x; })()); } }
function stored() { var x, o = { f: false, g: 0 }, list = []; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; o.f = +x === x; list.push(+x === x); list[i] = x - 0 === x; o.g += +x === x ? 1 : 0; say(o.f); } say(list.join()); say(o.g); }
function joined() { var x, y; for (var i = 0; i < 8; i++) { if (i === 3) x = 1; if (i === 5) y = 1; if (i === 6) x = undefined; var n = +x, m = +y; say(n === m); say(n === y); say(x === m); say(x === y); say(n == m); say(n <= m); say(n >= y); } }
function kept() { var x, t; for (var i = 0; i < 8; i++) { if (i === 3) x = 4; t = +x; say(t === x); if (i > 4) t = x; say(t === x); say(t === +x); } }
function nullish() { var x = null; for (var i = 0; i < 8; i++) { if (i === 3) x = 0; if (i === 5) x = undefined; say(+x === x); say(+x == x); say(+x === +x); say(+x === 0); } }
function notted() { var x; for (var i = 0; i < 6; i++) { if (i === 3) x = 1; say(!(+x === x)); say((+x === x) && i > 3); say((+x === x) || i < 1); say((+x === x) === (x !== undefined)); } }
function both() { var x, y; for (var i = 0; i < 6; i++) { if (i === 3) { x = 1; y = 1; } say(Math.floor(x) === Math.floor(y)); say(Math.max(x, 0) === x); say(-(-x) === x); } }
for (var f of [plus, times, rounded, twice, same, branch, chosen, returns, stored, joined, kept, nullish, notted, both]) { f(); line(f.name); }
