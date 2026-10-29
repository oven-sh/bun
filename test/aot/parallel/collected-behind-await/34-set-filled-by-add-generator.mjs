// The same with a set filled by add().
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
async function setFilledByAdd(n, wait) {
  const holder = new Set();
  holder.add(make(n));
  await wait("a set filled by add");
  return 1;
}
await setFilledByAdd(0, stepsGenerator);
