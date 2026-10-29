// A suspended function holds what its text reads behind the suspension, also on a path that the arguments of this program never take, and an iteration that goes on behind the suspension holds what it walks. Asked while the function is suspended.
let last;
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

async function readOnAPathNeverTaken(n) {
  const x = make(n);
  await pause("a local read behind the await on a path never taken");
  if (n < 0) return x.n;
  return 1;
}
async function readOnlyInFront(n) {
  const x = make(n);
  if (n < 0) return x.n;
  await pause("a local read only in front of the await");
  return 1;
}
async function listWalkedByForOf(n) {
  for (const x of [make(n)]) {
    await pause("the list that for-of walks, left behind the await");
    return 1;
  }
}
async function listWalkedToItsEnd(n) {
  for (const x of [make(n)]) if (n < 0) return x.n;
  await pause("a list that for-of has walked to its end");
  return 1;
}
function* yieldsOnAPathNeverTaken(n) {
  const x = make(n);
  yield 1;
  if (n < 0) yield x.n;
}
async function generatorAtItsYield(n) {
  const generator = yieldsOnAPathNeverTaken(n);
  generator.next();
  await pause("generator: a local read behind the yield on a path never taken");
  return generator.next().done;
}
async function* stepsOnAPathNeverTaken(n) {
  const x = make(n);
  yield 1;
  if (n < 0) yield x.n;
}
async function asyncGeneratorAtItsYield(n) {
  const generator = stepsOnAPathNeverTaken(n);
  await generator.next();
  await pause("async generator: a local read behind the yield on a path never taken");
  return (await generator.next()).done;
}

await readOnAPathNeverTaken(1);
await readOnlyInFront(3);
await listWalkedByForOf(4);
await listWalkedToItsEnd(5);
await generatorAtItsYield(6);
await asyncGeneratorAtItsYield(7);
