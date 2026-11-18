// A short list of arguments for each call.
// Sizes: 1000 4000 16000
// Passes: 81
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function total(...values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
function old(this: unknown): number {
  return arguments.length + (arguments[1] as number);
}
function pass(a: number, b: number, c: number): number {
  const list = [a, b, c];
  return total(...list) + (old as any)(a, b) + total.apply(null, list) + total.call(null, a) + total.bind(null, b)(c);
}
function once(): string {
  let sum = 0;
  for (let i = 0; i < size * 3; i++) sum = (sum + pass(i & 3, i & 7, 1)) | 0;
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
