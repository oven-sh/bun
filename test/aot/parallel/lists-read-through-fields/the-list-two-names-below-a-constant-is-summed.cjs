"use strict";
const box = { page: { rows: JSON.parse(process.argv[2] ?? "[1,2,3,4.5]") } };
function sum(start) { let total = start; for (let place = 0; place < box.page.rows.length; place++) total = total + box.page.rows[place]; return total; }
for (let turn = 0; turn < 3; turn++) console.log("SAID", sum(turn));
