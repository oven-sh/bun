"use strict";
class Store { constructor(rows, more) { this.rows = rows; this.more = more; } run(start, tens) { let total = start; for (let place = 0; place < this.rows.length; place++) { total = total + this.rows[place] * this.more[place]; if (place === 1) this.more = tens; } return total; } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"), JSON.parse(process.argv[3] ?? "[1,1,1,1]"));
console.log("SAID", store.run(0, [10, 10, 10, 10]));
console.log("SAID", store.run(0, [0.5, 0.5, 0.5, 0.5]));
