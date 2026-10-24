// Species: fiber programs  map numbers loop. It prints what plain Bun prints.
const counts = new Map();
function bump(key, by) { const before = counts.get(key); counts.set(key, before === undefined ? by : (before + by) & 1023); }
function total() { let sum = 0; for (let key = 0; key < 64; key++) { const value = counts.get(key); if (value !== undefined) sum += value * 2 + 1; } return sum; }
let sum = 0;
for (let round = 0; round < 300000; round++) { bump(round & 63, round & 7); if ((round & 255) === 0) sum += total(); }
console.log(sum, counts.size);
