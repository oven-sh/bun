// reads a name that an object with more keys than its type lacks; the receiver's type is declared and has an index signature
interface Named {
  id: number;
  [key: string]: unknown;
}
const operations = 20;
const made: Named[] = [];
for (let i = 0; i < operations; i++) made.push({ id: i, ["key" + (i % 4)]: i });
const lacks = (named: Named): number => (named.missing === undefined ? 1 : 0);
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) total += lacks(made[i]);
}

console.log(total);
