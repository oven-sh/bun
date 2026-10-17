// takes the remainder of a negative whole number, as a wrap-around index does
const operations = 100;
const steps: number[] = [];
for (let i = 0; i < operations; i++) steps.push(-1 - i);
const size: number = [12][0];
let total = 0;

kernel: {
  for (let i = 0; i < steps.length; i++) total += ((steps[i] % size) + size) % size;
}

console.log(total);
