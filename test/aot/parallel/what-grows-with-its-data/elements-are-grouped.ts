// Map.groupBy and Object.groupBy.
// Sizes: 1000 4000 16000
// Passes: 24
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  const byMap = Map.groupBy(numbers, x => x % 10),
    byObject = Object.groupBy(numbers, x => (x & 1 ? "odd" : "even"));
  return [byMap.size, byMap.get(3)!.length, byObject.odd!.length].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
