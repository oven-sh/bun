// makes an array of three numbers that are not known to be integers
const operations = 100;
const values: number[] = [];
for (let i = 0; i < operations; i++) values.push(i * 0.5);
const made: number[][] = [];
for (let i = 0; i < operations; i++) made.push([0.5]);
let total = 0;

kernel: {
  for (let i = 0; i < values.length; i++) made[i] = [values[i], values[i] + 1, 2.5];
  total += made[7][1];
}

console.log(total);
