// What is read stands on the left of an element, a constant and a product; numbers come first, then a text, null and a word.
"use strict";
const rows = JSON.parse(process.argv[2] ?? '[{"x":1},{"x":2.5},{"x":-0},{"x":"3"},{"x":null},{"x":"a"}]');
const steps = [10, 20, 0, 40, 50, 60];
function sums(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i].x + steps[i]);
    out.push(list[i].x > 1);
    out.push(list[i].x + i * 2);
  }
  return out;
}
for (let round = 0; round < 3; round++) console.log(sums(rows).map(value => typeof value + ":" + String(value)).join());
