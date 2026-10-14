var log = [];
function show(o) { return Object.keys(o).join() + " " + JSON.stringify(o); }
function id(x) { return x; }
var a = { name: "a", k: 1 }; for (var i = 0; i < 3; i++) a["x" + i] = i; log.push("1 module, no try: " + show(a));
try { var b = { name: "b", k: 1 }; for (var i = 0; i < 3; i++) b["x" + i] = i; log.push("2 module, try: " + show(b)); } catch (e) { log.push("2 threw"); }
try { var c = { name: id("c"), k: id(1) }; for (var i = 0; i < 3; i++) c["x" + i] = i; log.push("3 module, try, calls: " + show(c)); } catch (e) { log.push("3 threw"); }
function f(n) { try { var o = { name: n, k: 1 }; for (var i = 0; i < 3; i++) o["x" + i] = i; return show(o); } catch (e) { return "threw"; } }
log.push("4 function, try: " + f("d")); for (var r = 0; r < 300; r++) f("w"); log.push("5 function, try, hot: " + f("e"));
function g(n) { var o = { name: n, k: 1 }; for (var i = 0; i < 3; i++) o["x" + i] = i; return show(o); }
log.push("6 function, no try: " + g("f")); for (var r = 0; r < 300; r++) g("w"); log.push("7 function, no try, hot: " + g("g"));
function h(n, keys) { try { var o = { name: id(n) }; for (var key of keys) o[key] = n; return show(o); } catch (e) { return "threw"; } }
log.push("8 function, try, for-of: " + h("h", ["p", "q"]));
function j(src) { var o; try { o = { name: "j", first: id(1) }; } catch (e) { o = {}; } for (var key in src) o[key] = src[key]; return show(o); }
log.push("9 literal in try, loop behind it: " + j({ p: 1, q: 2 }));
console.log(log.join("\n"));
