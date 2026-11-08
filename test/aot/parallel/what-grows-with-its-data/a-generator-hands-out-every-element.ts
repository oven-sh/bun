// yield, yield*, and a generator left early for each element.
// Sizes: 1000 4000 16000
// Passes: 77
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function* upTo(count: number): Generator<number> {
  for (let i = 0; i < count; i++) yield i & 15;
}
function* twice(count: number): Generator<number> {
  yield* upTo(count);
  yield* upTo(count);
}
function firstOf(count: number): number {
  for (const x of upTo(count)) return x + 1;
  return 0;
}
function once(): string {
  let sum = 0;
  for (const x of twice(size * 3)) sum += x;
  for (let i = 0; i < size; i++) sum += firstOf(size);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
