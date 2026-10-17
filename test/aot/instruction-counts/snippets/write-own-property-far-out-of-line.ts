// stores to a property that lies far out of line in objects with hundreds of properties
const operations = 100;
function tableOf(seed: number): any {
  const table: Record<string, number> = {};
  for (let i = 0; i < 300; i++) table["p" + i] = seed + i;
  return table;
}
const tables = [tableOf(1), tableOf(2), tableOf(3), tableOf(4)];
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) tables[i & 3].p250 = i;
  total += tables[3].p250;
}

console.log(total);
