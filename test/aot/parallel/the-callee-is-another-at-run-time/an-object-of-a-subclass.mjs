const kept = [];
function work(n) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i + n) | 0; return t; }
function borrow(value, visit) { const t = work(value); visit(value); return t; }
function keeper(value, visit) { const t = work(value); kept.push(visit); visit(value); return t; }
class Tool { run(value, visit) { const t = work(value); visit(value); return t; } }
class Keeping extends Tool { run(value, visit) { return keeper(value, visit); } }
let tool = new Tool();
function change() { tool = new Keeping(); }
function maker(start) {
  let count = start * 3;
  const t = tool.run(start, (x) => count + (x & 0));
  count += 1;
  return t + count;
}
let sum = 0;
const wanted = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 150) change();
  sum += maker(turn);
  if (turn >= 150) wanted.push(turn * 3 + 1);
}
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  if (kept[i](0) !== wanted[i]) wrong++;
}
console.log(sum, kept.length, wanted.length, wrong);
