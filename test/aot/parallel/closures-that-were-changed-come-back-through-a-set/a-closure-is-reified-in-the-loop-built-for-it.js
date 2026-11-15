function make(step) { return (x) => x + step; }
function dbl(x) { return x * 2; }
function run(f, n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i === 3) Object.keys(f);
    sum += f(i);
  }
  return sum + work;
}
const plusOne = make(1), plusTen = make(10);
let total = 0;
for (let turn = 0; turn < 200; turn++) total += run(turn % 3 === 0 ? plusOne : turn % 3 === 1 ? plusTen : dbl, 6);
console.log(total, run(plusOne, 6), run(plusTen, 6), run(dbl, 6));
