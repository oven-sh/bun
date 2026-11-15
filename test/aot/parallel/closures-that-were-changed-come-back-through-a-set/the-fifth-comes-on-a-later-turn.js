function a(x) { return x + 1; }
function b(x) { return x + 2; }
function c(x) { return x + 3; }
function d(x) { return x + 4; }
function e(x) { return x + 5; }
function run(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let f = a;
  let sum = 0;
  for (let turn = 0; turn < n; turn++) {
    for (let i = 0; i < 4; i++) sum += f(i);
    f = turn === 0 ? b : turn === 1 ? c : turn === 2 ? d : e;
  }
  return sum + work;
}
let total = 0;
for (let turn = 0; turn < 200; turn++) total += run(6);
console.log(total, run(1), run(3));
