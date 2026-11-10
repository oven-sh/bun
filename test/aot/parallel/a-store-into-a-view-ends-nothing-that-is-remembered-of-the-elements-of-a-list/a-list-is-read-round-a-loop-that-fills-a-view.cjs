"use strict";
// The loop writes a view alone; what the list held in front is what it holds behind.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function fill(list, view, count) {
  const first = list[0];
  for (let i = 0; i < count; i++) view[i] = first[i % 6] + i;
  return list[0] === first ? list[0][1] + view[count - 1] : -1;
}
const said = [];
for (let round = 0; round < 5; round++) { const view = new Float64Array(8); said.push(fill(data, view, 3 + round)); }
console.log(said.join(" "));
