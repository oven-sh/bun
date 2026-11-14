const log = [];
function say(x) { log.push(x); return x; }
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o); }
function boom(stop) { log.push("boom"); if (stop) throw new Error("stop"); return 10; }
function make(stop) { let x = 0, y = 0; try { const o = { a: (x = say(1) | 0), b: say(2) | 0, c: say(3) | 0, d: say(4) | 0, e: say(5) | 0, f: say(6) | 0, g: say(7) | 0, h: say(8) | 0, i: (y = say(9) | 0), j: boom(stop) | 0, k: (x = say(11) | 0) }; return show(o) + " " + x + " " + y; } catch (error) { return error.message + " " + x + " " + y; } }
console.log("SAID", make(true), make(false), log.join());
