import { shelf } from "./shelf.mjs";
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) total = total + shelf.rows[place]; return total; }
for (let turn = 0; turn < 3; turn++) console.log("SAID", sum(turn));
