// However often a turn begins again, the getter runs once for each read that is written.
"use strict";
let reads = 0;
const rows = JSON.parse(process.argv[2] ?? '[{"x":1},{"x":2},{"x":3},{"x":4}]');
Object.defineProperty(rows[2], "x", { get() { reads++; return reads < 3 ? 7 : "8"; } });
function run(list) {
  let sum = "";
  for (let i = 0; i < list.length; i++) sum += String(list[i].x + 1) + ";";
  return sum;
}
for (let round = 0; round < 4; round++) console.log(run(rows), reads);
