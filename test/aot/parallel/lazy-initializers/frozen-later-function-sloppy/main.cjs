// As ../frozen-later-function, in sloppy code.
// Alone: what is put off goes by all that the executable holds

const { read, readArrow } = require("./m.cjs");
Object.freeze(Function.prototype);
try { const f = read(), g = readArrow(); console.log(String(f), typeof f.call, Object.keys(f).join(), String(g), typeof g.bind); } catch (e) { console.log(e.name + ": " + e.message); }
