"use strict";
class Store { constructor(rows) { this.rows = rows; } flip(other, next) { for (let place = 0; place < this.rows.length; place++) { this.rows[place] = 32 - this.rows[place]; if (place === 1) other.rows = next; } return this.rows.join(); } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const first = store.rows;
console.log("SAID", store.flip(store, [10, 20, 30, 40, 50]), first.join());
