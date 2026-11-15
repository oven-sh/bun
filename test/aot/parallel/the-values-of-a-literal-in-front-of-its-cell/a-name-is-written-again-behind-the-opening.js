const log = [];
function say(x) { log.push(x); return x; }
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o); }
function make() { return { a: say(1) | 0, b: say(2) | 0, c: say(3) | 0, d: say(4) | 0, e: say(5) | 0, f: say(6) | 0, g: say(7) | 0, h: say(8) | 0, i: say(9) | 0, a: say(10) | 0, j: say(11) | 0 }; }
console.log("SAID", show(make()), log.join());
