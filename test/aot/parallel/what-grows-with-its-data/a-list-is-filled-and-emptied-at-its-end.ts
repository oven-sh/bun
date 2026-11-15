// push and pop.
// Sizes: 1000 4000 16000
// Passes: 200
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function fill(list: number[], count: number): void {
  for (let i = 0; i < count; i++) list.push(i & 255);
}
function drain(list: number[]): number {
  let sum = 0;
  while (list.length) sum += list.pop()!;
  return sum;
}
function once(): string {
  const list: number[] = [];
  fill(list, size * 16);
  return [drain(list)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
