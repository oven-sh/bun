// A function reads a name between two suspensions and never again, and collections run at the second. An executable lets go of what the name holds behind its last use, whether a closure
// shares the name or not, and also while the function waits for an arrow function that is made and called in the operand of the `await`: docs/compiler/compatibility.mdx, "Memory".
// Plain Bun prints another output.
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
async function pause(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    overwritten = overwriteStack(200, overwritten);
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}
async function pauseWithoutAsking() {
  await new Promise(resolve => setTimeout(resolve, 1));
}

async function localReadBetween(n) {
  const x = make(n);
  await pauseWithoutAsking();
  sink += x.n;
  await pause("a local read between two suspensions");
  return 1;
}
for (let n = 0; n < 1; n++) {
  const waiting = localReadBetween(n);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
async function localReadBetweenThenCleared(n) {
  let x = make(n);
  await pauseWithoutAsking();
  sink += x.n;
  x = null;
  await pause("a local read between two suspensions, then cleared");
  return 1;
}
for (let n = 0; n < 1; n++) {
  const waiting = localReadBetweenThenCleared(n);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
async function sharedReadBetween(n) {
  const x = make(n);
  const late = () => x.n;
  await pauseWithoutAsking();
  sink++;
  await pause("a shared name, a name of the module read between two suspensions");
  return 1;
}
for (let n = 0; n < 1; n++) {
  const waiting = sharedReadBetween(n);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
async function blockLeftBetween(n) {
  {
    const x = make(n);
    const late = () => x.n;
    await pauseWithoutAsking();
  }
  const p = pause("a shared name of a block that is left between two suspensions");
  await p;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const waiting = blockLeftBetween(n);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
function* stepsLocal(n) {
  const x = make(n);
  yield 1;
  sink += x.n;
  yield 2;
  return 1;
}
for (let n = 0; n < 1; n++) {
  const walker = stepsLocal(n);
  walker.next();
  walker.next();
  overwritten = overwriteStack(200, overwritten);
  await pause("a local of a generator read between two yields");
  walker.next();
}
async function waitsForAnArrowFunction(n) {
  const x = make(n);
  const late = () => x.n;
  await (async () => {
    await pause("a shared name, an arrow function made and called in the operand");
  })();
  return 1;
}
for (let n = 0; n < 1; n++) {
  const waiting = waitsForAnArrowFunction(n);
  overwritten = overwriteStack(200, overwritten);
  await waiting;
}
console.log("sum", typeof (sink + overwritten));
/* Output:
a local read between two suspensions: collected
a local read between two suspensions, then cleared: collected
a shared name, a name of the module read between two suspensions: collected
a shared name of a block that is left between two suspensions: collected
a local of a generator read between two yields: collected
a shared name, an arrow function made and called in the operand: collected
sum number
*/
