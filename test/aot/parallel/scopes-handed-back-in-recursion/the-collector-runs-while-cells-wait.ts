function walk(depth: number): number {
  let total = depth;
  let text = "d" + depth;
  function add(x: number) { total += x; text += x; }
  if (depth) add(walk(depth - 1));
  if (depth === 3) Bun.gc(true);
  add(text.length);
  return total;
}
let sum = 0;
for (let round = 0; round < 30; round++) { sum += walk(12); if (round % 7 === 0) Bun.gc(true); }
console.log(sum);
