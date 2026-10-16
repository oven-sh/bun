// calls a function that stays a call
function add(x: number, sum: number): number {
  if (x < 0) return process.argv.length;
  return x + sum;
}
const operations = 100;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) sum = add(numbers[i], sum);
  total += sum;
}

console.log(total);
