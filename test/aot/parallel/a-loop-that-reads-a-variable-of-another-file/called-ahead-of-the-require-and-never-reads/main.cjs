function run(turns, reads) { let s = 0; for (let i = 0; i < turns; i++) { if (reads) s = lib.add(s, i); else s += 2; } return s; }
const turns = JSON.parse("20");
console.log("SAID early", run(turns, JSON.parse("false")));
const lib = require("./lib.cjs");
console.log("SAID late", run(turns, JSON.parse("true")));
