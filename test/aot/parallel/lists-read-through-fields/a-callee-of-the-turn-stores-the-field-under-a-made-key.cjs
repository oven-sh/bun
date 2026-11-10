"use strict";
class Store { constructor(rows) { this.rows = rows; } flip(hooks, name) { for (let place = 0; place < this.rows.length; place++) { this.rows[place] = 32 - this.rows[place]; hooks[name](this, place); } return this.rows.join(); } }
const key = (process.argv[3] ?? "ro") + "ws";
const hooks = { swap(store, place) { if (place === 1) store[key] = [10, 20, 30, 40, 50]; } };
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const first = store.rows;
console.log("SAID", store.flip(hooks, "swap"), first.join());
