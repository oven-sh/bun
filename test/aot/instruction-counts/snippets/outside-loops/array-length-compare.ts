// compares the length of an array with a number, outside loops
const operations = 4;
let numbers: number[] = [1, 2, 3, process.argv.length];
let total = 0;

kernel: {
  if (numbers.length < 3) total += 1;
  if (numbers.length < 5) total += 2;
  if (numbers.length > 7) total += 3;
  if (numbers.length > 2) total += 4;
}

console.log(total);
