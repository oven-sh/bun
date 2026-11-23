import { shelf, hooks } from "./shelf.mjs";
function sum(name) { let total = 0; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; hooks[name](place); } return total; }
console.log("SAID", sum(process.argv[3] ?? "swap"), shelf.rows.length);
