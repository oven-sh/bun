// What a function made and reads no more behind an await is collected while a function that it awaits runs on after a wait. Asked from that function, which waits in several ways.
let last;
let sink = 0;
let overwritten = 1;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
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
  overwritten = overwriteStack(200, overwritten);
  for (let round = 0; round < 4; round++) Bun.gc(true);
}
function report(label) {
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
}
const timer = () => new Promise(resolve => setTimeout(resolve, 1));

async function waitsOnce(label) {
  await timer();
  collect();
  report(label + ", waits once");
  return 1;
}
async function waitsBehindSettledValues(label) {
  const a = await 1;
  const b = await a;
  await timer();
  collect();
  report(label + ", waits behind settled values");
  return a + b;
}
async function waitsOnOnePath(label) {
  let kept = 0;
  if (label.length > 1000) kept = await timer();
  else await timer();
  collect();
  report(label + ", waits on one of two paths");
  return kept;
}
async function keepsMoreLater(label) {
  await timer();
  collect();
  report(label + ", keeps more over later waits");
  const a = [label.length];
  const b = [a.length];
  await timer();
  const c = [a[0] + b[0]];
  await timer();
  return a[0] + b[0] + c[0];
}
function* yields(label) {
  yield 1;
  collect();
  report(label + ", a generator behind its first yield");
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
const waits = [waitsOnce, waitsBehindSettledValues, waitsOnOnePath, keepsMoreLater, stepsGenerator];

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

let n = 0;
for (const wait of waits) {
  for (const holds of [map, mapFilledBySet, set, local, list]) await holds(n++, wait);
}
console.log(sink, overwritten);
