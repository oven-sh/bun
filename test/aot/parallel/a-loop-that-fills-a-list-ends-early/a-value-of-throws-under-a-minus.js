// A loop of very many turns pushes onto a list and ends in its third turn by a throw out of code that an operand runs: the list is not given room for all the turns.
"use strict";
const turns = Number(process.argv[2] ?? 120000000);
function fill(part, count) {
  const list = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum = -part;
    list.push(i);
  }
  return list.length + sum;
}
let asked = 0;
const other = { valueOf() { if (++asked === 3) throw new Error("left"); return 1; } };
try {
  console.log(fill(other, turns));
} catch (error) {
  console.log(error.message, process.memoryUsage().rss < 400000000);
}
