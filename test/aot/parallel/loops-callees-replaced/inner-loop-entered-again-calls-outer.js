// The callee is read in front of two loops. The inner loop, which is entered once a turn of the outer one, calls it, and a turn of the outer loop replaces it.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function picker(list) {
  return x => list[x & 3] + list.length;
}
function adder(n) {
  return x => x + n;
}
function work(first, second, at, rows) {
  let step = first;
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    if (row === at) step = second;
    for (let cell = 0; cell < 3; cell++) sum = mix(sum, step(cell));
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(picker([i, 1, 2, 3]), i & 1 ? adder(i) : Math.sqrt, i % 9, 8));
console.log(total);
