// A loop of very many turns pushes onto a list and ends in its third turn by a throw out of code that an operand runs: the list is not given room for all the turns.
"use strict";
const turns = Number(process.argv[2] ?? 120000000);
function fill(parts, count) {
  const list = [];
  let seen = 0;
  for (let i = 0; i < count; i++) {
    seen = [...parts].length;
    list.push(i);
  }
  return list.length + seen;
}
let asked = 0;
const other = { [Symbol.iterator]() { if (++asked === 3) throw new Error("left"); return [][Symbol.iterator](); } };
try {
  console.log(fill(other, turns));
} catch (error) {
  console.log(error.message, process.memoryUsage().rss < 400000000);
}
