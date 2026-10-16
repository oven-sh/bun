// writes an array of numbers at the index of the loop
const operations = 100;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 0.5);
let total = 0;

kernel: {
  for (let i = 0; i < numbers.length; i++) numbers[i] = i;
  total += numbers[7];
}

console.log(total);
