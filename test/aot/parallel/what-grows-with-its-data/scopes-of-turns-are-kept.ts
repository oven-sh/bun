// A closure over the variable of each turn, and a chain of scopes of fixed depth.
// Sizes: 250 1000 4000
// Passes: 1700
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function deep(a: number): () => number {
  return () => {
    const b = a + 1;
    return (() => {
      const c = b + 1;
      return (() => a + b + c)();
    })();
  };
}
function once(): string {
  const kept: (() => number)[] = [];
  for (let i = 0; i < size * 2; i++) {
    let own = i & 15;
    kept.push(() => own++ + (i % 3));
  }
  let sum = 0;
  for (const f of kept) sum += f() + f();
  for (let i = 0; i < size * 2; i++) sum = (sum + deep(i & 7)()) | 0;
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
