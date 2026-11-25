// Array.from, fill, new Array and a spread of keys.
// Sizes: 1000 4000 16000
// Passes: 200
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function make(count: number): number {
  const a = Array.from({ length: count }, (_, i) => i & 7),
    b = new Array<number>(count).fill(3),
    c = [...Array(count).keys()];
  return a[count - 1]! + b[count >> 1]! + c[count - 1]!;
}
function once(): string {
  return [make(size * 4)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
