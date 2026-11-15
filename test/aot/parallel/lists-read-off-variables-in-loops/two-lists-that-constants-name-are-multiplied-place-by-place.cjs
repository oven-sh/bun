"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3,4.5]"), more = JSON.parse(process.argv[3] ?? "[2,3,4,5]");
function sum(start) { let total = start; for (let place = 0; place < rows.length; place++) total = total + rows[place] * more[place]; return total; }
for (let turn = 0; turn < 3; turn++) console.log("SAID", sum(turn));
