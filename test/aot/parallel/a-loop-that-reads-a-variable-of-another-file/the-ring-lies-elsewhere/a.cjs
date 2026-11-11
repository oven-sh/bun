exports.run = function run(turns, reads) { let s = 0; for (let i = 0; i < turns; i++) { if (reads) s = b.add(s, i); else s += 2; } return s; };
const c = require("./c.cjs");
const b = require("./b.cjs");
