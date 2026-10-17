// sorts a copy of an array of numbers with a comparator in a small function
const operations = 64;
function sortedCopyOf(numbers: number[]): number[] {
  const sorted = numbers.slice();
  sorted.sort((a, b) => a - b);
  return sorted;
}
const unsorted: number[] = [];
let seed = 12345;
for (let i = 0; i < operations; i++) {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  unsorted.push(seed % 100000);
}
let total = 0;

kernel: {
  const sorted = sortedCopyOf(unsorted);
  total += sorted[10] + sorted[50];
}

console.log(total);
