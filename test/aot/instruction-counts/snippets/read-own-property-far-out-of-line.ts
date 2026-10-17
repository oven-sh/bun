// reads a property that lies far out of line in objects with hundreds of properties
const operations = 100;
function tableOf(seed: number): any {
  const table: Record<string, number> = {};
  for (let i = 0; i < 300; i++) table["p" + i] = seed + i;
  return table;
}
const tables = [tableOf(1), tableOf(2), tableOf(3), tableOf(4)];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += tables[i & 3].p250;
  total += sum;
}

console.log(total);
