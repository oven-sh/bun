// A set, and a generator that yields once.
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
}
async function stepsShortGenerator(label) {
  const steps = yields(label);
  steps.next();
  await timer();
  steps.next();
  return 1;
}
async function set(n, wait) {
  const holder = new Set([make(n)]);
  await wait("a set");
  return 1;
}
await set(0, stepsShortGenerator);
