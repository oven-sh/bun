"use strict";
const shelf = { rows: JSON.parse(process.argv[2] ?? "[1,2,3,4]"), more: 1 };
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; if (place === 1) delete shelf.rows; } return total; }
try { console.log("SAID", sum(0)); } catch (error) { console.log("SAID", error.name, Object.keys(shelf).join()); }
