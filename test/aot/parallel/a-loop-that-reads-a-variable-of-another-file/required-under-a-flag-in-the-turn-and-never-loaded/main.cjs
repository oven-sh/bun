const wants = JSON.parse("false"), turns = JSON.parse("20");
let s = 0;
for (let i = 0; i < turns; i++) { if (wants) s = require("./color.cjs").paint(s, i); else s += 2; }
console.log("SAID", s);
