"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3]");
let more = [1];
function sum(start) { let total = start; for (let place = 0; place < rows.length; place++) total = total + rows[place] + more[place]; return total; }
for (const list of [["a", "b", "c"], [1, "b", 3], [1, , 3], [{ toString() { return "x"; } }, 2, 3], [1n, 2, 3], [null, true, undefined], new Float32Array([0.5, 1.5, 2.5]), "xyz", [[1], [2], [3]]]) {
  more = list;
  try { console.log("SAID", sum(0), sum("t")); } catch (error) { console.log("SAID", error.name); }
}
