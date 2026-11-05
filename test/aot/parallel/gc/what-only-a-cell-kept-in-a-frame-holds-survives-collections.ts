// Flags: --aot-testing=CheckProofsAtRunTime --aot-disable=pass:InlineCalls,pass:InlineHeads
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
// An object and a closure that are kept in the frame of their function are all that holds a list and a text while callees collect.
// A build that checks its proofs at run time lays such cells outside the stack, and what they hold stays alive as it does in any other build.
type Holder = { inner: number[]; text: string };
const turns = process.argv.length > 99 ? 50 : 30;
function churn(): number {
  let n = 0;
  for (let i = 0; i < 2000; i++) n += [i, i + 1, i + 2].length + String(i).length;
  return n;
}
function read(h: Holder): number {
  Bun.gc(true);
  const n = churn();
  Bun.gc(true);
  return h.inner[0] + h.inner[1] + h.text.length + (n & 1);
}
function call(add: (b: number) => number): number {
  Bun.gc(true);
  churn();
  return add(1);
}
function keep(a: number): number {
  const list = [a, a + 1, a + 2].map(x => x * 2);
  const h: Holder = { inner: list, text: "t" + a + "x".repeat(a) };
  const other = [a * 3, a * 5].map(x => x + 1);
  return read(h) + call(b => other[0] + other[1] + b);
}
let sum = 0;
for (let i = 0; i < turns; i++) sum += keep(i);
console.log(sum);
