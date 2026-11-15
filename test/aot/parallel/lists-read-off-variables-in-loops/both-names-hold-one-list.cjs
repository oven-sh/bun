"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3,4]"), more = rows;
function square(start) { let total = start; for (let place = 0; place < rows.length; place++) { total = total + rows[place] * more[place]; if (place === 0) more.push(5); } return total; }
console.log("SAID", square(0), rows.length);
