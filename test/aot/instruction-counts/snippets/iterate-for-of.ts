// adds up an array of numbers with for of
const operations = 100;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 0.5);
let total = 0;

kernel: {
  let sum = 0;
  for (const number of numbers) sum += number;
  total += sum;
}

console.log(total);
