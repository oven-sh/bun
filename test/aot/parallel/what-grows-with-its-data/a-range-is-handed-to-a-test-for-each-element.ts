// For each element a small test is handed a range that its caller has just made, reads three fields of it and keeps nothing.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 1000);
const passes = Number(process.env.PASSES ?? 2);

type Range = { low: number; high: number; step: number };

function lies(range: Range, value: number): boolean {
  let at = range.low;
  for (let turn = 0; turn < 2 && at < value; turn++) at += range.step;
  return value >= range.low && value <= range.high && at >= range.low;
}

function countWithin(values: number[], low: number, width: number): number {
  let found = 0;
  for (let index = 0; index < values.length; index++) {
    if (lies({ low: low + (index & 7), high: low + width, step: 3 }, values[index])) found++;
  }
  return found;
}

const values: number[] = [];
for (let index = 0; index < size; index++) values.push((index * 37) % 1000);

let total = 0;
for (let pass = 0; pass < passes; pass++) total += countWithin(values, 100 + (pass & 3), 500);
console.log(total, values.length);
