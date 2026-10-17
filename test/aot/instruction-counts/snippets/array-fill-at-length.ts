// fills an empty array of numbers by storing at its length
const operations = 16;
let total = 0;

kernel: {
  const numbers: number[] = [];
  for (let i = 0; i < operations; i++) numbers[numbers.length] = i;
  total += numbers.length;
}

console.log(total);
