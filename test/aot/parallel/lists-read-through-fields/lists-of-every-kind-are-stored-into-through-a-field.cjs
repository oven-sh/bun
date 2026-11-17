"use strict";
class Store { constructor(rows) { this.rows = rows; } halve() { for (let place = 0; place < this.rows.length; place++) this.rows[place] = this.rows[place] / 2; return Array.prototype.join.call(this.rows); } }
const store = new Store(null);
for (const rows of [[2, 4, 6], [1, 3, 5], [0.5, 1.5], [2, , 6], [2, "4", 6], [2, { valueOf() { return 8; } }], Object.freeze([2, 4]), new Int32Array([2, 3]), new Float64Array([1, 3]), new Uint8ClampedArray([255, 3]), { length: 2, 0: 4, 1: 6 }, [2n], "24", null]) {
  store.rows = rows;
  try { console.log("SAID", store.halve()); } catch (error) { console.log("SAID", error.name); }
}
