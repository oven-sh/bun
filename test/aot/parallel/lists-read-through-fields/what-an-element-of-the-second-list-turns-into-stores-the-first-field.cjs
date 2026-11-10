"use strict";
class Store { constructor(rows, more) { this.rows = rows; this.more = more; } run(start) { let total = start; for (let place = 0; place < this.rows.length; place++) total = total + this.rows[place] * this.more[place]; return total; } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"), null);
store.more = [1, 1, { valueOf() { store.rows = [10, 20, 30, 40, 50, 60]; return 1; } }, 1, 1, 1];
console.log("SAID", store.run(0), store.rows.length);
console.log("SAID", store.run(0), store.rows.length);
