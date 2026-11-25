const turns = JSON.parse("20");
let s = 0;
for (let i = 0; i < turns; i++) { const lib = require("./lib.cjs"); s = lib.add(s, i); }
console.log("SAID", s);
