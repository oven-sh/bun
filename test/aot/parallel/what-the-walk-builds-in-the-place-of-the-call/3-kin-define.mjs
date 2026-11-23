const kept = [];
function tread(n) { const a = n * 3, b = n ^ 5, c = n + 7, d = n - 9; return n > 0 ? tread(n - 1) + ((a + b + c + d) & 1) : 0; }
class Tool {
  run(value, visit) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; visit(value); return work; }
}
function keeper(value, visit) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(visit); return work; }
const tool = new Tool();
const name = JSON.parse('"run"');
function change() { Reflect.defineProperty(Tool.prototype, name, { value: keeper }); }
function maker(start) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = start * 3;
  work += tool.run(start, (x) => count + (x & 0));
  count += 1;
  return work + count;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) { sum += maker(turn); if (turn === 149) change(); }
tread(200); Bun.gc(true);
let wrong = 0;
for (let i = 0; i < kept.length; i++) if (kept[i](0) !== (150 + i) * 3 + 1) wrong++;
console.log(sum, kept.length, wrong);
