"use strict";
class Shelf { constructor(rows) { this.rows = rows; } }
const shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; if (place === 0) shelf.rows.push(5, 6.5); if (place === 3) shelf.rows.length = 5; } return total; }
console.log("SAID", sum(0), shelf.rows.join());
console.log("SAID", sum(0), shelf.rows.join());
