"use strict";
class Shelf { constructor(rows) { this.rows = rows; } }
const shelf = new Shelf(null);
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) total = total + shelf.rows[place]; return total; }
for (const rows of [null, undefined, "text", JSON.parse(process.argv[2] ?? "[1,2]"), new Float64Array([0.5, 1.5]), { length: 2, 0: 3, 1: 4 }, 7]) {
  shelf.rows = rows;
  try { console.log("SAID", sum(0)); } catch (error) { console.log("SAID", error.name); }
}
