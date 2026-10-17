// reads a name that an object with more keys than its type lacks, through a parameter of type any
interface Named {
  id: number;
}
const operations = 20;
const make = (key: string, id: number): Named => ({ id, [key]: id });
const made: any[] = [];
for (let i = 0; i < operations; i++) made.push(make("key" + (i % 4), i));
const lacks = (named: any): number => (named.missing === undefined ? 1 : 0);
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) total += lacks(made[i]);
}

console.log(total);
