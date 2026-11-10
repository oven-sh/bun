"use strict";
class Store { constructor(rows, more) { this.rows = rows; this.more = more; } run(start) { let total = start; for (let place = 0; place < this.rows.length; place++) total = total + this.rows[place] * this.more[place]; return total; } }
const store = new Store(JSON.parse(process.argv[2] ?? "[1,2,3,4]"), [1]);
for (const list of [[2, 3], [2, , 4, 5], ["2", "3", "4", "5"], [2, 3, 4, { valueOf() { return 7; } }], new Float64Array([0.5, 1.5, 2.5, 3.5]), "1234", { 0: 1, 1: 2, 2: 3, 3: 4 }, [1n, 2, 3, 4], null, undefined]) {
  store.more = list;
  try { console.log("SAID", store.run(0)); } catch (error) { console.log("SAID", error.name); }
}
