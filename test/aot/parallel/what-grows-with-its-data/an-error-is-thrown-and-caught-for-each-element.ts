// What a throw costs goes by the depth of the stack, which stays.
// Sizes: 1000 4000 16000
// Passes: 160
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function risky(i: number): number {
  if (i & 1) throw new RangeError("odd " + (i & 7));
  return i & 7;
}
function guarded(i: number, tally: { count: number }): number {
  try {
    return risky(i);
  } catch (error) {
    return (error as Error).message.length;
  } finally {
    tally.count++;
  }
}
function once(): string {
  const tally = { count: 0 };
  let sum = 0;
  for (let i = 0; i < size; i++) sum += guarded(i, tally);
  return [sum, tally.count].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
