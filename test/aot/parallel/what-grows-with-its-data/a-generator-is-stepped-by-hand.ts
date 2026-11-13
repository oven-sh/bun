// next() is called by hand, and of what it answers only `done` and `value` are read.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function* count(upTo: number): Generator<number, string, number> {
  let sent = 0;
  for (let i = 0; i < upTo; i++) sent = (sent + (yield (i & 15) + (sent & 1))) | 0;
  return "over " + (sent & 255);
}
function drain(upTo: number): string {
  const walk = count(upTo);
  let sum = 0,
    answer = 0;
  for (;;) {
    const step = walk.next(answer);
    if (step.done) return sum + " " + step.value;
    sum = (sum + step.value) | 0;
    answer = sum & 3;
  }
}
function once(): string {
  return drain(size * 4);
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
