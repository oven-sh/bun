// sorts a copy of an array of numbers that rise with a comparator
const operations = 64;
const unsorted: number[] = [];
for (let i = 0; i < operations; i++) unsorted.push(i * 3);
let total = 0;

kernel: {
  const sorted = unsorted.slice();
  sorted.sort((a, b) => a - b);
  total += sorted[10] + sorted[50];
}

console.log(total);
