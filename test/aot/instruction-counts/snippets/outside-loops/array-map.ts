// maps a short array with a small function, outside loops
const operations = 2;
let numbers: number[] = [1, 2, 3, process.argv.length];
let total = 0;

kernel: {
  total += numbers.map(n => n + 1).length;
  total += numbers.map(n => n * 2).length;
}

console.log(total);
