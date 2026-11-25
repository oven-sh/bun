"use strict";
const box = { page: { rows: JSON.parse(process.argv[2] ?? "[1,2,3,4]") } };
const other = { rows: JSON.parse(process.argv[3] ?? "[10,20,30,40,50]") };
function sum(start) { let total = start; for (let place = 0; place < box.page.rows.length; place++) { total = total + box.page.rows[place]; if (place === 1) box.page = other; } return total; }
console.log("SAID", sum(0), box.page.rows.length);
console.log("SAID", sum(1), box.page.rows.length);
