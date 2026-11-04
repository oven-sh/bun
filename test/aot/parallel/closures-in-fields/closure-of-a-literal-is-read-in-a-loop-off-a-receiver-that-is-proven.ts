// The object lies in a variable of the module, so its layout is proven wherever it is read. In a loop that does nothing else but add, the read of one of its closures is typed, and the first such read makes the closure.
function makeTools(seed: number) {
  let n = seed;
  return { bump: () => ++n, read: () => n, twice: () => n * 2 };
}
const tools = makeTools(1);
let kept: unknown = undefined;
let other: unknown = undefined;
let sum = 0;
for (let turn = 0; turn < 1000; turn++) {
  sum = (sum + turn) | 0;
  if (turn % 100 === 99) kept = tools.read;
  if (turn % 400 === 399) Bun.gc(true);
}
function spin(turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    total = (total + i) | 0;
    if (i === 3) other = tools.twice;
  }
  return total;
}
console.log(sum, spin(6), kept === tools.read, other === tools.twice, tools.bump(), tools.read(), tools.twice());
