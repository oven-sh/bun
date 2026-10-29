// Two calls.
let last;
let sink = 0;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
function collect() {
  for (let round = 0; round < 4; round++) Bun.gc(true);
}
const timer = () => new Promise(resolve => setTimeout(resolve, 1));
async function* yieldsAsync(label) {
  await timer();
  collect();
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  const a = [label.length];
  yield a;
  return a[0];
}
async function walksAsyncGenerator(label) {
  for await (const step of yieldsAsync(label)) sink += step[0];
  return 1;
}
async function map(n, wait) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
// The call is made far down the stack.
function below(depth, holds, n, wait) {
  if (depth === 0) return holds(n, wait);
  const waiting = below(depth - 1, holds, n, wait);
  sink += depth & 0;
  return waiting;
}
await below(300, map, 0, walksAsyncGenerator);
await below(300, map, 1, walksAsyncGenerator);
