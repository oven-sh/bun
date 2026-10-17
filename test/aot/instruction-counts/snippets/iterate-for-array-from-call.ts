// adds up an array of numbers that came out of a call with a for loop
const operations = 100;
function makeNumbers(depth: number): number[] {
  if (depth > 0) return makeNumbers(depth - 1);
  const made: number[] = [];
  for (let i = 0; i < operations; i++) made.push(i * 0.5);
  return made;
}
const numbers = makeNumbers(3);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) sum += numbers[i];
  total += sum;
}

console.log(total);
