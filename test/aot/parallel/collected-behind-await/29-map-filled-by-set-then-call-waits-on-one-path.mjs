// Deep calls between set() and the await.
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
function pad(depth) {
  return depth > 0 ? pad(depth - 1) + depth : sink;
}
async function mapFilledBySetThenCall(n, wait) {
  const holder = new Map();
  holder.set(n, make(n));
  sink += pad(40);
  await wait("a map filled by set, then a call");
  return 1;
}
await mapFilledBySetThenCall(0, waitsOnOnePath);
