const log = [];
function say(x) { log.push(x); return x; }
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o); }
const base = { set k(v) { log.push("setter"); }, inherited: 7 };
function above() { log.push("p"); return base; }
function make() { return { a: say(1) | 0, b: say(2) | 0, c: say(3) | 0, d: say(4) | 0, e: say(5) | 0, f: say(6) | 0, g: say(7) | 0, h: say(8) | 0, i: say(9) | 0, __proto__: above(), k: say(10) | 0, l: say(11) | 0 }; }
const made = make();
console.log("SAID", show(made), Object.getPrototypeOf(made) === base, made.inherited, log.join());
