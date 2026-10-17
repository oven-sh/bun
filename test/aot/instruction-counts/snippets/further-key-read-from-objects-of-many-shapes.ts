// reads a name beyond the declared type from objects whose further keys differ; the receiver's type is declared and has an index signature
interface Named {
  id: number;
  [key: string]: unknown;
}
const operations = 20;
const made: Named[] = [];
for (let i = 0; i < operations; i++) made.push({ id: i, ["key" + (i % 4)]: i, label: i });
const hasLabel = (named: Named): number => (named.label === undefined ? 0 : 1);
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) total += hasLabel(made[i]);
}

console.log(total);
