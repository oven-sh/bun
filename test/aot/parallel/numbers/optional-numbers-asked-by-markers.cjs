// STATISTIC: OptionalNumbersAskedByMarkers >= 4
"use strict";
class Box {
  constructor(low, high) {
    this.low = low;
    this.high = high;
  }
}
const values = new Float64Array([0.5, 2.25, -1, 8, 3.5, NaN, 4]);
function least(box, count) {
  let found = box.low;
  for (let k = 0; k < count; k++) {
    const value = values[k];
    if (value < found) found = value;
  }
  return found;
}
function climb(box, count) {
  let sum = box.high, step = box.low;
  let k = 0;
  do {
    sum = sum + step * 0.5;
    step = step + values[k];
    k++;
  } while (k < count);
  return sum + step;
}
function clamp(box, count) {
  let low = box.low, high = box.high;
  while (count-- > 0) {
    low += 0.25;
    high -= 0.5;
    if (low > high) low = high;
  }
  return low + high;
}
const boxes = [new Box(1, 2), new Box(undefined, 3), new Box(0.5), new Box(-3.75, 1e300), new Box()];
for (let turn = 0; turn < 3; turn++) console.log(boxes.map((box) => [least(box, 5), climb(box, 4), clamp(box, 6), least(box, 7)].join("/")).join(" "));
boxes[0].low = undefined;
boxes[1].low = 7;
console.log(boxes.map((box) => [least(box, 5), climb(box, 4), clamp(box, 6)].join("/")).join(" "));
let total = 0;
for (let turn = 0; turn < 300; turn++) total += clamp(boxes[turn & 1], 3) || 0;
console.log(total);
