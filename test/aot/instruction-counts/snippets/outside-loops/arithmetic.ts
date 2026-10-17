// adds, subtracts and multiplies numbers, outside loops
const operations = 4;
let first: number = process.argv.length;
let second: number = process.argv.length + 3;
let total = 0;

kernel: {
  total += first + second;
  total += first - second;
  total += first * second;
  total += second - first;
}

console.log(total);
