import { shelf, other } from "./index.mjs";
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) total = total + other.rows[place]; return total; }
console.log("SAID", sum(0), shelf === other);
