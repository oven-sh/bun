"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3,4]"), more = JSON.parse(process.argv[3] ?? "[2,3,4,5]"), third = JSON.parse(process.argv[4] ?? "[1,1,1,0.5]");
function sum(start) { let total = start; for (let place = 0; place < rows.length; place++) total = total + rows[place] * more[place] - third[place]; return total; }
console.log("SAID", sum(0));
