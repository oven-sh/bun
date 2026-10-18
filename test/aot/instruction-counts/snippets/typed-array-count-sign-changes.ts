// counts how often neighbors in an Int32Array differ in sign
const operations = 100;
const readings = new Int32Array(operations);
for (let i = 0; i < operations; i++) readings[i] = ((i * 37) % 11) - 5;
let total = 0;

kernel: {
  let before = 0;
  for (let i = 0; i < readings.length; i++) {
    const now = readings[i]!;
    if (now < 0 !== before < 0) total++;
    before = now;
  }
}

console.log(total);
