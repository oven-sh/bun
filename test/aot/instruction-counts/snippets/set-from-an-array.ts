// makes a Set from an array of four strings
const lists = [
  ["http:", "https:", "mailto:", "tel:"],
  ["a", "b", "c", "a"],
];
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Set(lists[i & 1]).size;
}

console.log(sum);
