// adds up an array of numbers with a for loop in a small function
const operations = 100;
function sumOf(numbers: number[]): number {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) sum += numbers[i];
  return sum;
}
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 0.5);
let total = 0;

kernel: {
  total += sumOf(numbers);
}

console.log(total);
