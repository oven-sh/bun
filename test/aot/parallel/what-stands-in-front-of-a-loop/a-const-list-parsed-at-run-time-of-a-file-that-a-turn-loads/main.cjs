// What stands in front of a loop: a const list parsed at run time of a file that a turn loads.
"use strict";
function drive(turns) { let sum = 0; for (let t = 0; t < turns; t++) { const data = require("./data.cjs"); sum += data.total(2); } return sum; }
console.log("SAID " + drive(Number("0")) + " " + drive(Number("2")));
