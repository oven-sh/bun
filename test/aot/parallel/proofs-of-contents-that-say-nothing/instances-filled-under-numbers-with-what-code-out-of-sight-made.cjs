// STATISTIC: ProofsCheckedOfContents <= 1
'use strict';
const data = JSON.parse('[0,1,2,3,4,5,6,7]');
class Row { constructor() { this.length = 0; } }
const all = [];
for (const value of data) {
  const row = new Row();
  for (let i = 0; i < 8; i++) row[i] = value + i;
  row.length = 8;
  all.push(row);
}
function sumOf(turn) {
  const row = all[turn & 7];
  let sum = 0;
  for (let i = 0; i < 100; i++) sum = (sum + row[i & 7]) | 0;
  return sum;
}
let total = 0;
for (let turn = 0; turn < 50; turn++) total = (total + sumOf(turn)) % 1000003;
console.log(total);
