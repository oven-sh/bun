// next() of an async generator is awaited by hand, and of what it answers only `done` and `value` are read.
// Sizes: 1000 4000 16000
// Passes: 60
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
async function* count(upTo: number): AsyncGenerator<number, string, number> {
  let sent = 0;
  for (let i = 0; i < upTo; i++) sent = (sent + (yield (i & 15) + (sent & 1))) | 0;
  return "over " + (sent & 255);
}
async function drain(upTo: number): Promise<string> {
  const walk = count(upTo);
  let sum = 0,
    answer = 0;
  for (;;) {
    const step = await walk.next(answer);
    if (step.done) return sum + " " + step.value;
    sum = (sum + step.value) | 0;
    answer = sum & 3;
  }
}
async function once(): Promise<string> {
  return drain(size * 4);
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = await once();
console.log(told);
