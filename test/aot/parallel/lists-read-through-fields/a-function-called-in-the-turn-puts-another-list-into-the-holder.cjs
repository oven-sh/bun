"use strict";
class Shelf { constructor(rows) { this.rows = rows; } }
const shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const lists = JSON.parse(process.argv[3] ?? "[[5,6,7],[8,9,10,11,12]]");
const hooks = { swap(place) { if (place < lists.length) shelf.rows = lists[place]; return place; } };
function sum(name) { let total = 0; for (let place = 0; place < shelf.rows.length; place++) { total = total + shelf.rows[place]; hooks[name](place); } return total; }
console.log("SAID", sum(process.argv[4] ?? "swap"), shelf.rows.join());
