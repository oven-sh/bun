// map, filter, reduce, some, find.
// Sizes: 1000 4000 16000
// Passes: 69
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function chain(list: number[]): number {
  return list
    .map(x => x * 2)
    .filter(x => x % 3 !== 0)
    .reduce((a, b) => a + b, 0);
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  return [
    chain(numbers),
    numbers.some(x => x === -1),
    numbers.find(x => x === -1),
    numbers.findLast(x => x === 999),
  ].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
