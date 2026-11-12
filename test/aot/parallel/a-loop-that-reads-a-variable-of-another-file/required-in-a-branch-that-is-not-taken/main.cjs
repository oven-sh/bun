const wants = JSON.parse("false"), turns = JSON.parse("20");
if (wants) { var color = require("./color.cjs"); }
let s = 0;
for (let i = 0; i < turns; i++) { if (wants) s = color.paint(s, i); else s += 2; }
console.log("SAID", s);
