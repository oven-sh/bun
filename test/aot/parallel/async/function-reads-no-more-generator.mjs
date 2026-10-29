// A function makes an object, reads it no more and awaits a function that walks an async generator. The generator waits once, and collections run while it is running again: the object is let go of,
// in the first call, which the module makes as it starts, and in the later ones, which a job makes.
let last;
let sink = 0;
let overwritten = 1;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
// A collection reads the stack word by word. Its own frames, and those of the event loop that calls the program again, lie where earlier calls have left theirs.
function overwriteStack(depth, a) {
  if (depth === 0) return a;
  const b = a + 1;
  const c = b * 2;
  const d = c - a;
  const e = d + b;
  const f = e * 3;
  const g = f - c;
  const h = g + d;
  const i = h * 5;
  const j = i - e;
  const k = j + f;
  const l = k * 7;
  const m = l - g;
  return (overwriteStack(depth - 1, m % 1000) + b + c + d + e + f + g + h + i + j + k + l) % 1000;
}
function collect() {
  for (let round = 0; round < 4; round++) {
    overwritten = overwriteStack(200, overwritten);
    Bun.gc(true);
  }
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
let n = 0;
for (const holds of [map, mapFilledBySet, set, set, map, mapFilledBySet, mapFilledBySet, map]) {
  const waiting = holds(n++, walksAsyncGenerator);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
