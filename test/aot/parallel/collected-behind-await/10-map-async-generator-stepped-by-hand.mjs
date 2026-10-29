// A map, and an async generator stepped by next().
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
async function stepsAsyncGeneratorByHand(label) {
  const steps = yieldsAsync(label);
  sink += (await steps.next()).value[0];
  await steps.next();
  return 1;
}
async function map(n, wait) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
await map(0, stepsAsyncGeneratorByHand);
