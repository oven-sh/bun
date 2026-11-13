// What a generator at its yield holds of what its text reads behind it, also on a path that the arguments of this program never take, and what a function lets go that it
// reads only in front of the suspension. Asked while the function is suspended. What the build proves that nothing reads again may go earlier than in plain Bun: not asked.
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
  if (label !== undefined) console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}

async function readOnAPathNeverTaken(n) {
  const x = make(n);
  await pause();
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
    await pause();
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

console.log("a function that reads a local on a path never taken answers", await readOnAPathNeverTaken(1));
await readOnlyInFront(3);
console.log("a function that leaves a for-of loop behind an await answers", await listWalkedByForOf(4));
await listWalkedToItsEnd(5);
// The two arguments come from where the build cannot know them: of a written number it proves that the path is never taken, and then the local may go.
await generatorAtItsYield(process.argv.length + 4);
await asyncGeneratorAtItsYield(process.argv.length + 5);
