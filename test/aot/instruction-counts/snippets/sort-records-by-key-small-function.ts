// sorts a copy of an array of records by a numeric key in a small function
const operations = 64;
class Rec {
  constructor(
    public name: string,
    public key: number,
  ) {}
}
function sortedCopyOf(records: Rec[]): Rec[] {
  const sorted = records.slice();
  sorted.sort((a, b) => a.key - b.key);
  return sorted;
}
const unsorted: Rec[] = [];
let seed = 12345;
for (let i = 0; i < operations; i++) {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  unsorted.push(new Rec("r", seed % 100000));
}
let total = 0;

kernel: {
  const sorted = sortedCopyOf(unsorted);
  total += sorted[10].key + sorted[50].key;
}

console.log(total);
