// The five holders in their order.
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
function* yields(label) {
  yield 1;
  collect();
  report(label);
  const a = [label.length];
  yield a;
  return a[0];
}
async function stepsGenerator(label) {
  const steps = yields(label);
  steps.next();
  await timer();
  steps.next();
  steps.next();
  return 1;
}
async function map(n, wait) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
async function mapFilledBySet(n, wait) {
  const holder = new Map();
  holder.set(n, make(n));
  await wait("a map filled by set");
  return 1;
}
async function set(n, wait) {
  const holder = new Set([make(n)]);
  await wait("a set");
  return 1;
}
async function local(n, wait) {
  const x = make(n);
  sink += x.n;
  await wait("a local");
  return 1;
}
async function list(n, wait) {
  const holder = [n, make(n)];
  sink += holder.length;
  await wait("a list");
  return 1;
}
await map(0, stepsGenerator);
await mapFilledBySet(1, stepsGenerator);
await set(2, stepsGenerator);
await local(3, stepsGenerator);
await list(4, stepsGenerator);
