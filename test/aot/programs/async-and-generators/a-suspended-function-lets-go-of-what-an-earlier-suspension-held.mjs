// A function reads a name between two suspensions and never again, and collections run at the second. An executable lets go of what the name holds behind its last use, whether a closure
// shares the name or not, and also while the function waits for an arrow function that is made and called in the operand of the `await`: docs/compiler/compatibility.mdx, "Memory".
// Plain Bun prints another output.
let last;
let sink = 0;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
async function pause(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
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
for (let n = 0; n < 1; n++) await localReadBetween(n);
async function localReadBetweenThenCleared(n) {
  let x = make(n);
  await pauseWithoutAsking();
  sink += x.n;
  x = null;
  await pause("a local read between two suspensions, then cleared");
  return 1;
}
for (let n = 0; n < 1; n++) await localReadBetweenThenCleared(n);
async function sharedReadBetween(n) {
  const x = make(n);
  const late = () => x.n;
  await pauseWithoutAsking();
  sink++;
  await pause("a shared name, a name of the module read between two suspensions");
  return 1;
}
for (let n = 0; n < 1; n++) await sharedReadBetween(n);
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
for (let n = 0; n < 1; n++) await blockLeftBetween(n);
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
for (let n = 0; n < 1; n++) await waitsForAnArrowFunction(n);
console.log("sum", typeof sink);
