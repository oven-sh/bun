// pushes numbers onto an empty array
const operations = 100;
let total = 0;

kernel: {
  const numbers: number[] = [];
  for (let i = 0; i < operations; i++) numbers.push(i);
  total += numbers.length;
}

console.log(total);
