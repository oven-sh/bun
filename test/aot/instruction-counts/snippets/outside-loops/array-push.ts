// appends to an array, outside loops
const operations = 4;
let numbers: number[] = [process.argv.length];
let total = 0;

kernel: {
  numbers.push(total);
  numbers.push(total + 1);
  numbers.push(total + 2);
  numbers.push(total + 3);
  total += 1;
}

console.log(total, numbers.length);
