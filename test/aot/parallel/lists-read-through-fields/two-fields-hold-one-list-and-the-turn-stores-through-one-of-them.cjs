"use strict";
class Store { constructor(rows) { this.rows = rows; this.more = rows; } shift() { let total = 0; for (let place = 0; place + 1 < this.rows.length; place++) { this.more[place + 1] = this.rows[place] + 1; total = total + this.rows[place + 1]; } return total + ":" + this.rows.join(); } }
console.log("SAID", new Store(JSON.parse(process.argv[2] ?? "[1,10,20,30]")).shift());
console.log("SAID", new Store([0.5, 10, 20, 30]).shift());
