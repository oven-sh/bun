// calls a closure that is one of two at run time
function makeAdder(amount: number): (x: number) => number {
  return x => (x < 0 ? process.argv.length : x + amount);
}
function makeSubtractor(amount: number): (x: number) => number {
  return x => (x < 0 ? process.argv.length : x - amount);
}
const operations = 100;
const change = process.argv.length > 50 ? makeSubtractor(2) : makeAdder(1);
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) sum += change(numbers[i]);
  total += sum;
}

console.log(total);
