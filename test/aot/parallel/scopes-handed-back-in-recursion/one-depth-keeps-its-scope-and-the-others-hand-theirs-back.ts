const kept: (() => number)[] = [];
function walk(depth: number, keepAt: number): number {
  let total = depth * 10;
  function add(x: number) { total += x; }
  if (depth === keepAt) kept.push(() => total);
  if (depth) add(walk(depth - 1, keepAt));
  add(1);
  return total;
}
const answers: number[] = [];
for (let round = 0; round < 40; round++) answers.push(walk(8, round % 9));
console.log(answers.join(), kept.map(f => f()).join(), new Set(kept).size);
