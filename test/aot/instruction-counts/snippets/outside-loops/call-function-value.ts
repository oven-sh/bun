// calls a function that a variable holds, outside loops
const operations = 4;
function plusOne(n: number): number {
  return n + 1;
}
function plusTwo(n: number): number {
  return n + 2;
}
let step: (n: number) => number = process.argv.length > 50 ? plusTwo : plusOne;
let total = 0;

kernel: {
  total = step(total);
  total = step(total);
  total = step(total);
  total = step(total);
}

console.log(total);
