// indexOf and includes with a place to begin at; what is sought is near.
// Sizes: 1000 4000 16000
// Passes: 190
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function nextAt(list: number[], what: number, from: number): number {
  return list.indexOf(what, from);
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  let at = 0,
    found = 0;
  while (at >= 0 && at < numbers.length) {
    const next = nextAt(numbers, numbers[Math.min(at + 3, numbers.length - 1)]!, at);
    if (next < 0) break;
    found++;
    at = next + 1;
  }
  return [found, numbers.includes(999, numbers.length - 4)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
