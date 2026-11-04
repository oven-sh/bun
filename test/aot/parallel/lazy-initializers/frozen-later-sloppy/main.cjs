// As ../frozen-later. In sloppy code an assignment that is refused is dropped without a word.

const { read } = require("./m.cjs");
Object.freeze(Object.prototype);
try { const o = read(); console.log(String(o), Object.keys(o).join()); } catch (e) { console.log(e.name + ": " + e.message); }
