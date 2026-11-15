"use strict";
class Store { constructor(rows) { this.rows = rows; } grow(most) { for (let place = 0; place < this.rows.length && place < most; place++) this.rows[place + 2] = this.rows[place] * 2; return this.rows.join(); } }
console.log("SAID", new Store(JSON.parse(process.argv[2] ?? "[1,2]")).grow(6));
console.log("SAID", new Store([1.5]).grow(4));
