// fills an empty array of numbers by storing at the index of the loop
const operations = 16;
let total = 0;

kernel: {
  const numbers: number[] = [];
  for (let i = 0; i < operations; i++) numbers[i] = i;
  total += numbers.length;
}

console.log(total);
