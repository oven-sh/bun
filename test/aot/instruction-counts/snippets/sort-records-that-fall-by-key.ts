// sorts a copy of an array of records that fall by a numeric key
const operations = 64;
class Rec {
  constructor(
    public name: string,
    public key: number,
  ) {}
}
const unsorted: Rec[] = [];
for (let i = 0; i < operations; i++) unsorted.push(new Rec("r", (operations - i) * 3));
let total = 0;

kernel: {
  const sorted = unsorted.slice();
  sorted.sort((a, b) => a.key - b.key);
  total += sorted[10].key + sorted[50].key;
}

console.log(total);
