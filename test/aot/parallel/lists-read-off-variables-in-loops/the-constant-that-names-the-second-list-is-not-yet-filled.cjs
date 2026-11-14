"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3]");
function sum(start) { let total = start; for (let place = 0; place < rows.length; place++) total = total + rows[place] * more[place]; return total; }
try { console.log("SAID", sum(0)); } catch (error) { console.log("SAID", error.name, error.message); }
const more = JSON.parse(process.argv[3] ?? "[2,2,2]");
console.log("SAID", sum(0));
