// adds up an array of numbers with a for loop
const operations = 100;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 0.5);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) sum += numbers[i];
  total += sum;
}

console.log(total);
