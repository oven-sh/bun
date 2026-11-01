// `total += i & 255; return total & 1023`: the sum is stored as a number and its low bits are taken in the same turn.
// The variable starts as a whole number, a fraction, at the edges of int32 and of the whole numbers a double holds, and as what is no number to count with.
let total = 0;
function turn(i) {
  total += i & 255;
  return total & 1023;
}
function less(i) {
  total -= i & 255;
  return total | 0;
}
function bench(step, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + step(i)) | 0;
  return sum;
}
console.log(bench(turn, 200000), total, bench(less, 200000), total);
const starts = [0.5, -0.5, -0, 2147483000, -2147484000, 4294967000, 9007199254740000, -9007199254740900, 1e21, NaN, Infinity, -Infinity];
for (const start of starts) {
  total = start;
  const up = bench(turn, 3000);
  const reached = total;
  total = start;
  console.log(start, up, reached, bench(less, 3000), total);
}
