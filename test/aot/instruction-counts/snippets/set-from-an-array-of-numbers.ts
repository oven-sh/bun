// makes a Set from an array of four numbers
const lists = [
  [1, 2, 3, 4],
  [5, 6, 7, 5],
];
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Set(lists[i & 1]).size;
}

console.log(sum);
