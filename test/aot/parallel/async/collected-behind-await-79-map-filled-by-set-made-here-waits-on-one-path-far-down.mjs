// The object is made in the function that holds it.
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
function report(label) {
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
}
const timer = () => new Promise(resolve => setTimeout(resolve, 1));
async function waitsOnOnePath(label) {
  let kept = 0;
  if (label.length > 1000) kept = await timer();
  else await timer();
  collect();
  report(label);
  return kept;
}
async function mapFilledBySetWithObjectMadeHere(n, wait) {
  const made = { n };
  last = new WeakRef(made);
  const holder = new Map();
  holder.set(n, made);
  await wait("a map filled by set with an object made here");
  return 1;
}
// The call is made far down the stack.
function below(depth, holds, n, wait) {
  if (depth === 0) return holds(n, wait);
  const waiting = below(depth - 1, holds, n, wait);
  sink += depth & 0;
  return waiting;
}
await below(300, mapFilledBySetWithObjectMadeHere, 0, waitsOnOnePath);
