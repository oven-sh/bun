// keeps the elements of an array that are not false, null or empty with filter(Boolean)
const operations = 16;
const words: (string | null)[] = [];
for (let i = 0; i < operations; i++) words.push(i % 4 ? "w" + i : null);
let total = 0;

kernel: {
  total += words.filter(Boolean).length;
}

console.log(total);
