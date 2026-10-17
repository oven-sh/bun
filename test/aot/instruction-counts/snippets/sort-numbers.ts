// sorts a copy of an array of numbers with a comparator
const operations = 64;
const unsorted: number[] = [];
let seed = 12345;
for (let i = 0; i < operations; i++) {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  unsorted.push(seed % 100000);
}
let total = 0;

kernel: {
  const sorted = unsorted.slice();
  sorted.sort((a, b) => a - b);
  total += sorted[10] + sorted[50];
}

console.log(total);
