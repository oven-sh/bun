// makes an empty array of numbers
const operations = 100;
const made: number[][] = [];
for (let i = 0; i < operations; i++) made.push([0.5]);
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) made[i] = [];
  total += made[7].length;
}

console.log(total);
