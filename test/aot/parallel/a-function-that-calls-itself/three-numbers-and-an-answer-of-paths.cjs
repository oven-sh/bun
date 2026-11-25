// case: three parameters and an answer: ways over a board
"use strict";
function ways(right, down, left) {
  if (right < 0 || down < 0 || left < 0) return 0;
  if (right === 0 && down === 0) return left === 0 ? 1 : left;
  return ways(right - 1, down, left) + ways(right, down - 1, left) * 2 + ways(right - 1, down - 1, left - 1);
}
function middle(low, high, depth) {
  if (depth === 0 || high - low < 2) return low + high;
  const half = (low + high) >> 1;
  return middle(low, half, depth - 1) - middle(half, high, depth - 1);
}
for (const [right, down, left] of [[0, 0, 0], [3, 2, 1], [5, 5, 2], [4, 7, 0], [6, 1, 3], [-1, 2, 2]]) console.log(right, down, left, ways(right, down, left));
let sum = 0;
for (let at = 0; at < 40; at++) sum += ways(at % 5, at % 4, at % 3) + middle(0, at, at % 6);
console.log(sum, middle(0, 1000, 8), middle(5, 5, 3), middle(-40, 30, 5));
console.log(ways(2.5, 1, 1), ways("2", 1, 1), ways(1, 1, "x"), ways(2, 2), middle(0.5, 9.5, 2), middle("1", "5", 2));
try {
  middle(0, 2 ** 30, Infinity);
  ways(1e6, 0, 0);
  console.log("ended");
} catch (error) {
  console.log(error.constructor.name);
}
