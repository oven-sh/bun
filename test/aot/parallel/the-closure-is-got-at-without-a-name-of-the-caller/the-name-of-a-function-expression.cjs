const kept = [];
function work(n) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i + n) | 0; return t; }
function borrow(value, visit) { const t = work(value); visit(value); return t; }
function maker(start) {
  let count = start * 3;
  const t = borrow(start, function self(x) { if (x >= 0) kept.push(self); return count + (x & 0); });
  count += 1;
  return t + count;
}
let sum = 0;
const wanted = [];
for (let turn = 0; turn < 300; turn++) {
  sum += maker(turn);
  wanted.push(turn * 3 + 1);
}
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  if (typeof kept[i] !== "function" || kept[i](-1) !== wanted[i]) wrong++;
}
console.log(sum, kept.length, wrong);
