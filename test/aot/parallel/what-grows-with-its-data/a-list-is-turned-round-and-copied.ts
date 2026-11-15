// reverse, toReversed, with, copyWithin, slice of the whole: once each.
// Sizes: 1000 4000 16000
// Passes: 330
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function turnRound(list: number[]): number {
  const a = list.toReversed(),
    b = list.slice().reverse(),
    c = list.with(1, -1),
    d = list.slice().copyWithin(0, 4);
  return a[0]! + b[1]! + c[1]! + d[0]!;
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  return [turnRound(numbers)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
