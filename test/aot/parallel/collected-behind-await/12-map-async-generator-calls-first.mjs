// A map, and an async generator that makes deep calls before it collects.
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
function pad(depth) {
  return depth > 0 ? pad(depth - 1) + depth : sink;
}
async function* yieldsAsync(label) {
  await timer();
  sink += pad(40);
  collect();
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  const a = [label.length];
  yield a;
  return a[0];
}
async function walksAsyncGeneratorThatCallsFirst(label) {
  for await (const step of yieldsAsync(label)) sink += step[0];
  return 1;
}
async function map(n, wait) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
await map(0, walksAsyncGeneratorThatCallsFirst);
