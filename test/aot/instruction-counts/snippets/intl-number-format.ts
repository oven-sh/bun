// formats a whole number with an Intl.NumberFormat whose locale is a constant
const format = new Intl.NumberFormat("en-US");
const operations = 20;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i * 98_765 + 7);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < numbers.length; i++) length += format.format(numbers[i]).length;
  total += length;
}

console.log(total);
