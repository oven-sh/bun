// reads a property that lies far out of line in a prototype with hundreds of properties
const operations = 100;
function parentOf(seed: number): any {
  const parent: Record<string, number> = {};
  for (let i = 0; i < 300; i++) parent["p" + i] = seed + i;
  return parent;
}
const children = [Object.create(parentOf(1)), Object.create(parentOf(2)), Object.create(parentOf(3)), Object.create(parentOf(4))];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += children[i & 3].p250;
  total += sum;
}

console.log(total);
