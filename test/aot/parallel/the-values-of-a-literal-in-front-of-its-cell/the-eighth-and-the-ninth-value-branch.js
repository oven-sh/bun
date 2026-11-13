const log = [];
function say(x) { log.push(x); return x; }
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o); }
function make(c) { return { a: say(1) | 0, b: say(2) | 0, c: say(3) | 0, d: say(4) | 0, e: say(5) | 0, f: say(6) | 0, g: say(7) | 0, h: c ? say(8) | 0 : say(80) | 0, i: c ? say(9) | 0 : say(90) | 0, j: say(10) | 0, k: 11 }; }
console.log("SAID", show(make(true)), show(make(false)), log.join());
