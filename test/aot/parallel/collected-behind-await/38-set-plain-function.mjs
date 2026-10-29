// A set, and a plain function in place of the generator.
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
function collectsAndReports(label) {
  collect();
  report(label);
  return [label.length];
}
async function callsPlainFunction(label) {
  await timer();
  sink += collectsAndReports(label)[0];
  return 1;
}
async function set(n, wait) {
  const holder = new Set([make(n)]);
  await wait("a set");
  return 1;
}
await set(0, callsPlainFunction);
