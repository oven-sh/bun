"use strict";
const numbers = [1.5, 2.5, 3.5];
const labels = ["x", "y"];

function lastLabel(list, turn) {
  let last = "";
  let sum = turn & 1;
  for (let k = 0; k < 40; k++) {
    sum += list[k & 1] * 2;
    last = list[k & 3] + labels[0];
  }
  return sum + "|" + last;
}

const out = [];
for (let turn = 0; turn < 200; turn++) out.push(lastLabel(numbers, turn));
console.log(out[0], out[199]);
