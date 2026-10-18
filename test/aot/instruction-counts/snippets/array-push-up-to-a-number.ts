// pushes numbers onto an empty array up to a bound that is worked out as a number
const operations = 2000;
const scale = Number("0.5");
let total = 0;

kernel: {
  const numbers: number[] = [];
  for (let i = 0; i < Math.floor(operations * 2 * scale); i++) numbers.push(i);
  total += numbers.length;
}

console.log(total);
