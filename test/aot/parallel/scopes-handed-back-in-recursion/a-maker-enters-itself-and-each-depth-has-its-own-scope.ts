function walk(depth: number, width: number): number {
  let total = depth;
  function add(x: number) { total += x; }
  for (let i = 0; i < width; i++) add(depth ? walk(depth - 1, width) : i);
  add(1);
  return total;
}
let sum = 0;
for (let round = 0; round < 50; round++) sum += walk(6, 3);
console.log(sum, walk(0, 4), walk(9, 1));
