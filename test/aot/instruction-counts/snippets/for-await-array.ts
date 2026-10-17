// iterates with for await over an array of numbers
const operations = 20;
const numbers: number[] = [];
for (let i = 0; i < operations; i++) numbers.push(i);
let total = 0;

kernel: {
  for await (const n of numbers) total += n;
}

console.log(total);
