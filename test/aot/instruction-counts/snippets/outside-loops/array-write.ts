// writes elements of an array, outside loops
const operations = 4;
let numbers: number[] = [1, 2, 3, 4, 5, 6, process.argv.length];
let at: number = process.argv.length > 50 ? 3 : 1;
let total = 0;

kernel: {
  numbers[at] = total;
  numbers[at + 1] = total;
  numbers[at + 2] = total;
  numbers[at + 3] = total;
  total += 1;
}

console.log(total, numbers.join());
