// slice, spread and a pattern over eight elements at a place.
// Sizes: 1000 4000 16000
// Passes: 110
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function windowAt(list: number[], at: number): number {
  const part = list.slice(at, at + 8);
  const [first, second, ...rest] = part;
  return Math.max(...part) + first! + second! + rest.length + [...part, 1].length;
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  let sum = 0;
  for (let at = 0; at + 8 <= numbers.length; at += 8) sum += windowAt(numbers, at);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
