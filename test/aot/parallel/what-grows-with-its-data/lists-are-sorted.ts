// Numbers with a comparer, texts without.
// Sizes: 1000 4000 16000
// Passes: 7
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function sorted(list: number[]): number[] {
  return list.slice().sort((a, b) => a - b);
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  const texts = numbers.map(x => "k" + x);
  const a = sorted(numbers),
    b = texts.slice().sort(),
    c = numbers.toSorted((x, y) => y - x);
  return [a[0], a[a.length - 1], b[0], b[b.length - 1], c[0]].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
