// makes an array of five numbers, outside loops
const operations = 2;
let first: number = process.argv.length;
let kept: number[] = [];
let total = 0;

kernel: {
  kept = [first, total, first, total, first];
  total += kept.length;
  kept = [total, first, total, first, total];
  total += kept.length;
}

console.log(total);
