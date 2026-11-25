function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log("SAID early", run(JSON.parse("0")));
const lib = require("./lib.cjs");
console.log("SAID late", run(JSON.parse("20")));
