// STATISTIC: ProofsCheckedOfContents <= 0
'use strict';
function make(size) {
  const like = { length: size };
  for (let i = 0; i < size; i++) like[i] = i * 3;
  return like;
}
const like = make(16);
function sumOf(turn) {
  let sum = 0;
  for (let i = 0; i < 16; i++) sum = (sum + like[(i + turn) & 15]) | 0;
  return sum;
}
let total = 0;
for (let turn = 0; turn < 40; turn++) total = (total + sumOf(turn)) % 1000003;
console.log(total);
