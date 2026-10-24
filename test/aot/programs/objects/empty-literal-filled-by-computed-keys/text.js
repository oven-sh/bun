var log = [];
function show(o) { return Object.keys(o).join() + " " + JSON.stringify(o); }
function id(x) { return x; }
var a = {}; a.name = "a"; a.k = 1; for (var i = 0; i < 3; i++) a["x" + i] = i; log.push("1 module, {} then names: " + show(a));
function f(n) { var o = {}; o.name = n; o.k = 1; for (var i = 0; i < 3; i++) o["x" + i] = i; return show(o); }
log.push("2 function: " + f("b")); for (var r = 0; r < 300; r++) f("w"); log.push("3 function, hot: " + f("c"));
function g(n, src) { var o = {}; o.name = id(n); o.k = id(1); for (var key in src) o[key] = src[key]; return show(o); }
log.push("4 function, calls, for-in: " + g("d", { p: 1, q: 2 }));
function h(n, src) { const o = {}; o.name = n; for (const [key, value] of Object.entries(src)) o[key] = value; o.last = 1; return show(o); }
log.push("5 function, entries, a name behind the loop: " + h("e", { p: 1 }));
function j(n, src) { var o = Object.create(null); o.name = n; o.k = 1; for (var key in src) o[key] = src[key]; return Object.keys(o).join() + " " + o.name; }
log.push("6 null prototype: " + j("f", { p: 1 }));
function k(src) { var o = {}; for (var key in src) o[key] = src[key]; return show(o); }
log.push("7 nothing but keys (bykey1's own ground): " + k({ p: 1, q: 2 }));
function m(n, src) { var o = {}; if (n) { o.name = n; o.k = 1; } for (var key in src) o[key] = src[key]; return show(o); }
log.push("8 names under a condition: " + m("g", { p: 1 }) + " | " + m("", { p: 1 }));
console.log(log.join("\n"));
