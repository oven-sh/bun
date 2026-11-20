// A loop appends to one row and reads others: that they are other rows is checked in front of the loop, and what they hold is read there.
// STATISTIC: ArraysComparedWithStoredArrays >= 1
"use strict";
function blend(out, left, right, count) {
  for (let at = 0; at < count; at++) out[at] = left[0] * right[1] + left[2] * at - right[0];
  return out;
}
function grow(rows, count) {
  const out = rows[3];
  const one = rows[0];
  const two = rows[1];
  for (let at = 0; at < count; at++) out[at] = one[1] * at + two[0] * one[2] + two[2];
  return out;
}
const text = row => Array.from(row, (one, at) => (at in row ? String(one) : "hole")).join(" ");
const fresh = () => [[0.5, 1.5, 2], [3, -0.25, 4], [1, 2, 3], []];
for (let round = 0; round < 40; round++) {
  const rows = fresh();
  rows[0][1] = round / 4;
  const line = text(blend([], rows[0], rows[1], 5)) + " | " + text(grow(rows, 4));
  if (round % 13 === 0) console.log(line);
}
const one = [1.5, 2.5, 3.5];
console.log(text(blend(one, one, [1, 2, 3], 5)));
const two = [0.5, 2, 4];
console.log(text(blend(two, [1, 2, 3], two, 4)), text(blend(two, two, two, 3)));
const rows = fresh();
rows[3] = rows[0];
console.log(text(grow(rows, 5)));
rows[3] = rows[1] = rows[0] = [2, 3, 4];
console.log(text(grow(rows, 4)));
console.log(text(blend([], [1, , 3], [4, 5], 3)), text(blend([], ["2", "3", "4"], [1, 1, 1], 2)), text(blend([], [1], [2], 2)));
console.log(text(blend(new Float32Array(3), new Int8Array([1, 2, 3]), [0.5, 1], 4)), text(blend([9, 9, 9, 9], [1, 2, 3], [4, 5, 6], 2)));
const view = new Float64Array([1, 2, 3, 4]);
console.log(text(blend(view.subarray(1), view, view, 3)), text(view));
for (const row of [Object.freeze([1]), undefined]) {
  try {
    console.log(text(blend(row, [1, 2, 3], [1, 2, 3], 2)));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
