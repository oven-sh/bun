// finds the greatest element of an Int32Array, its place and how many are odd
const operations = 100;
const readings = new Int32Array(operations);
for (let i = 0; i < operations; i++) readings[i] = (i * 7919) % 1013;
let total = 0;

kernel: {
  let greatest = -1;
  let place = -1;
  let odd = 0;
  for (let i = 0; i < readings.length; i++) {
    const now = readings[i]!;
    if (now > greatest) {
      greatest = now;
      place = i;
    }
    if (now & 1) odd++;
  }
  total += greatest + place + odd;
}

console.log(total);
