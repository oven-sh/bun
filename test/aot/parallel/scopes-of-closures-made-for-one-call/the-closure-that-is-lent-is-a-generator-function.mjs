const runs = [];
function work(n) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i + n) | 0; return t; }
function borrow(value, visit) { const t = work(value); const run = visit(value); runs.push(run); run.next(); return t; }
function maker(start) {
  let count = start * 3;
  const t = borrow(start, function* (x) { yield count; yield count + (x & 0); });
  count += 1;
  return t + count;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += maker(turn);
let wrong = 0;
for (let i = 0; i < 300; i++) if (runs[i].next().value !== i * 3 + 1) wrong++;
console.log(sum, runs.length, wrong);
