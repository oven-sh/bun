// The object is the key.
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
async function mapKeyedByObject(n, wait) {
  const holder = new Map([[make(n), n]]);
  await wait("a map keyed by the object");
  return 1;
}
await mapKeyedByObject(0, walksAsyncGenerator);
