const seen = [];
function work(n) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i + n) | 0; return t; }
function borrow(value, visit) { const t = work(value); visit(value); return t; }
function maker(start) {
  let count = start * 3;
  const t = borrow(start, async (x) => { await null; seen.push(count + (x & 0)); await null; seen.push(count + 1); });
  count += 1;
  return t + count;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += maker(turn);
for (let i = 0; i < 8; i++) await null;
let wrong = 0;
const sorted = seen.slice().sort((a, b) => a - b);
for (let i = 0; i < 300; i++) if (sorted[2 * i] !== i * 3 + 1 || sorted[2 * i + 1] !== i * 3 + 2) wrong++;
console.log(sum, seen.length, wrong);
