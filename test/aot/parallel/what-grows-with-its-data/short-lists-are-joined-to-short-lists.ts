// concat and spread of two short lists for each element.
// Sizes: 1000 4000 16000
// Passes: 76
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function both(a: number, b: number): number {
  const left = [a, a + 1],
    right = [b, b + 1, b + 2];
  return left.concat(right).length + [...left, ...right][3]!;
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  let sum = 0;
  for (let i = 1; i < numbers.length; i++) sum += both(numbers[i - 1]!, numbers[i]!);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
