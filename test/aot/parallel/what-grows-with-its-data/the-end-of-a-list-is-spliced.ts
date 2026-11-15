// splice near the end of a long list.
// Sizes: 1000 4000 16000
// Passes: 180
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function turn(list: number[]): number {
  const [gone] = list.splice(list.length - 3, 1);
  list.splice(list.length - 1, 0, gone! + 1);
  return gone!;
}
function once(): string {
  const numbers: number[] = [];
  for (let i = 0; i < size * 8; i++) numbers.push((i * 7919) % 1000);
  let sum = 0;
  for (let i = 0; i < size * 4; i++) sum = (sum + turn(numbers)) | 0;
  return [sum, numbers.length].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
