var log = [];
function show(o) { return Object.keys(o).join() + " " + JSON.stringify(o); }
function id(x) { return x; }
var b = { name: "b", hidden: false, count: 1 };
Object.defineProperty(b, "hidden", { enumerable: false }); log.push("1 no try, descriptor: " + show(b));
var c = { name: "c", hidden: false, count: 1 };
try { Object.defineProperty(c, "hidden", { enumerable: false }); log.push("2 try, descriptor: " + show(c)); } catch (e) { log.push("2 threw"); }
var d = {};
try { Object.defineProperty(d, "name", { value: "d", enumerable: true }); log.push("3 try, a new name: " + show(d) + " " + d.name); } catch (e) { log.push("3 threw"); }
try { var e1 = { name: "e", k: 1 }; log.push("4 try, a literal kept: " + show(e1)); } catch (e) { log.push("4 threw"); }
try { var f1 = id({ name: "f", k: 1 }); log.push("5 try, a literal handed on: " + show(f1)); } catch (e) { log.push("5 threw"); }
try { var g1 = { name: id("g"), k: id(1) }; log.push("6 try, members that are calls: " + show(g1)); } catch (e) { log.push("6 threw"); }
var stored = 0, h = { count: 1 };
try { Object.defineProperty(h, "count", { get: () => stored, set: (v) => { stored = v * 10; }, enumerable: true, configurable: true }); } catch (e) { log.push("7 threw"); }
h.count = 4; log.push("7 try, getter and setter: " + h.count + " " + stored + " " + typeof Object.getOwnPropertyDescriptor(h, "count").get);
var list = [];
try { list.push({ name: "zeta", v: 1 }); list.push({ name: "alpha", v: 2 }); list.push({ name: id("mid"), v: 3 }); } catch (e) { log.push("8 threw"); }
log.push("8 try, records pushed: " + (function () { try { return list.toSorted((x, y) => x.name.localeCompare(y.name)).map((r) => r.name).join(); } catch (e) { return e.constructor.name + ": " + e.message; } })());
console.log(log.join("\n"));
