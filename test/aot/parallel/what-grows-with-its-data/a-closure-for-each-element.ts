// Made, kept, called.
// Sizes: 250 1000 4000
// Passes: 4400
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function adder(by: number): (x: number) => number {
  return x => x + by;
}
function once(): string {
  const all: ((x: number) => number)[] = [];
  for (let i = 0; i < size * 2; i++) all.push(adder(i & 7));
  let sum = 0;
  for (const f of all) sum = (sum + f(1)) | 0;
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
