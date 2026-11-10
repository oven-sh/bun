"use strict";
class Shelf { constructor(rows) { this.rows = rows; } }
const shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const other = JSON.parse(process.argv[3] ?? "[10,20,30,40,50]");
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; if (place === 1) shelf.rows = other; } return total; }
console.log("SAID", sum(0), shelf.rows.length);
console.log("SAID", sum(1), shelf.rows.length);
