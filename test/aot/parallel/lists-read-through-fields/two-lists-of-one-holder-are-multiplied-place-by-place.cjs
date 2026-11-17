"use strict";
class Store { constructor(rows, more) { this.rows = rows; this.more = more; } run(start) { let total = start; for (let place = 0; place < this.rows.length; place++) total = total + this.rows[place] * this.more[place]; return total; } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4.5]"), JSON.parse(process.argv[3] ?? "[2,3,4,5]"));
function sum(start) { let total = start; for (let place = 0; place < store.rows.length; place++) total = total + store.rows[place] * store.more[place]; return total; }
for (let turn = 0; turn < 3; turn++) console.log("SAID", store.run(turn), sum(turn));
