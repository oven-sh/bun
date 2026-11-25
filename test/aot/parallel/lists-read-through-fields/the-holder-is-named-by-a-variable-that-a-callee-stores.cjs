"use strict";
class Shelf { constructor(rows) { this.rows = rows; } }
let shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const second = new Shelf(JSON.parse(process.argv[3] ?? "[10,20,30,40,50,60]"));
const hooks = { swap(place) { if (place === 2) shelf = second; } };
function sum(name) { let total = 0; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; hooks[name](place); } return total; }
console.log("SAID", sum(process.argv[4] ?? "swap"), shelf.rows.length);
