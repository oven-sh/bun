function* yields(...values: number[]): Generator<number> { for (let i = 0; i < values.length; i++) yield values[i] * 2; }
async function awaits(...values: number[]): Promise<number> { let s = 0; for (let i = 0; i < values.length; i++) s += await values[i]; return s; }
function nested(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) for (let j = 0; j <= i; j++) s = s * 2 + values[j]; return s; }
function labeled(...values: number[]): number { let s = 0; outer: for (let i = 0; i < values.length; i++) { for (let j = 0; j < 3; j++) { if (values[i] === j) continue outer; s += j; } s += 10; } return s; }
function whileLoop(...values: number[]): number { let s = 0; let i = 0; while (i < values.length) { s += values[i]; i++; } return s; }
function doLoop(...values: number[]): number { let s = 0; let i = 0; do { s += values[i] ?? 100; i++; } while (i < values.length); return s; }
for (let i = 0; i < 3; i++)
  console.log([...yields(i, 1, 2)].join(), nested(i, 1, 2), labeled(i, 1, 5), whileLoop(i, 1, 2), doLoop(i, 1), doLoop());
console.log(await awaits(1, 2, 3), await awaits());
