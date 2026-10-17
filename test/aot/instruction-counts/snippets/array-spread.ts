// copies an array of ten numbers with a spread
const operations = 20;
const lists: number[][] = [];
for (let i = 0; i < operations; i++) lists.push([i, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < lists.length; i++) length += [...lists[i]].length;
  total += length;
}

console.log(total);
