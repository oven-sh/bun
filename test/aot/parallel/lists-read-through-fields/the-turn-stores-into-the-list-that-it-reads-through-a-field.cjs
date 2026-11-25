"use strict";
class Store { constructor(rows) { this.rows = rows; } flip() { for (let place = 0; place < this.rows.length; place++) this.rows[place] = 32 - this.rows[place]; return this.rows.join(); } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
console.log("SAID", store.flip());
console.log("SAID", store.flip());
