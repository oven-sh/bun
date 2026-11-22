// Elements added at the start while others are removed at the end: the capacity of the array does not grow with the number of them.
"use strict";
const { describeArray } = require("bun:jsc");
function capacityOf(array) {
  const found = /vector length: (\d+)/.exec(describeArray(array));
  return found ? Number(found[1]) : array.length;
}
function queue(make, turns, remove) {
  const array = [];
  for (let i = 0; i < turns; i++) {
    array.unshift(make(i));
    if (array.length > 1000) remove(array);
  }
  return [array.length, JSON.stringify(array[0]), JSON.stringify(array[999]), capacityOf(array) < 3000].join(" ");
}
const pop = array => array.pop();
for (const make of [i => i, i => i / 4, i => ({ i }), i => "item " + i]) {
  console.log(queue(make, 60000, pop), queue(make, 30000, array => array.splice(1000)), queue(make, 30000, array => (array.length = 900)));
}
function spliced(turns) {
  const array = [];
  for (let i = 0; i < turns; i++) {
    array.splice(0, 0, i);
    if (array.length > 1000) array.pop();
  }
  return [array.length, array[0], array[999], capacityOf(array) < 3000].join(" ");
}
console.log(spliced(30000));
const both = [];
for (let i = 0; i < 60000; i++) {
  if (i % 3) both.unshift(i);
  else both.push(i);
  if (both.length > 1000) both.pop();
}
console.log(both.length, both[0], both[999], capacityOf(both) < 3000);
both.length += 5;
console.log(both.length, 1003 in both, both[1003], both.push(7), both.unshift(8), both[0], both.at(-1));
