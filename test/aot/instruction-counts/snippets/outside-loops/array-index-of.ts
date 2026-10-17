// looks for a number in an array, outside loops
const operations = 4;
let numbers: number[] = [1, 2, 3, process.argv.length + 10];
let wanted: number = process.argv.length > 50 ? 1 : 3;
let total = 0;

kernel: {
  total += numbers.indexOf(wanted);
  total += numbers.indexOf(wanted - 1);
  total += numbers.indexOf(wanted - 2);
  total += numbers.indexOf(wanted + 9);
}

console.log(total);
