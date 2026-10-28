// A suspended function holds the locals that its text names behind the suspension, also where a constant of the module says that the text never runs.
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
const isVerbose = false;
let sink = 0;

async function underAnIf(n) {
  const x = make(n);
  await pause("named in an if");
  if (isVerbose) console.log(x.n);
  return 1;
}
async function underAnElse(n) {
  const x = make(n);
  await pause("named in an else");
  if (!isVerbose) sink++;
  else console.log(x.n);
  return 1;
}
async function behindAnd(n) {
  const x = make(n);
  await pause("named behind &&");
  isVerbose && console.log(x.n);
  return 1;
}
async function inAnArmOfAConditional(n) {
  const x = make(n);
  await pause("named in an arm of a conditional");
  return isVerbose ? x.n : 1;
}
async function inALoop(n) {
  const x = make(n);
  await pause("named in the body of a loop");
  while (isVerbose) console.log(x.n);
  return 1;
}
async function inAClosure(n) {
  const x = make(n);
  await pause("named by a closure");
  if (isVerbose) setTimeout(() => console.log(x.n), 1);
  return 1;
}
async function inALaterTurn(n) {
  const x = make(n);
  for (let turn = 0; turn < 2; turn++) {
    if (isVerbose) console.log(x.n);
    if (turn === 0) await pause("named in front of the await, in a loop that comes round");
  }
  return 1;
}
async function onlyInFront(n) {
  const x = make(n);
  if (isVerbose) console.log(x.n);
  await pause("named only in front of the await");
  return 1;
}
function* yields(n) {
  const x = make(n);
  yield 1;
  if (isVerbose) console.log(x.n);
}
async function generatorAtItsYield(n) {
  const generator = yields(n);
  generator.next();
  await pause("generator: named in an if");
  return generator.next().done;
}
async function* steps(n) {
  const x = make(n);
  yield 1;
  if (isVerbose) console.log(x.n);
}
async function asyncGeneratorAtItsYield(n) {
  const generator = steps(n);
  await generator.next();
  await pause("async generator: named in an if");
  return (await generator.next()).done;
}

await underAnIf(1);
await underAnElse(2);
await behindAnd(3);
await inAnArmOfAConditional(4);
await inALoop(5);
await inAClosure(6);
await inALaterTurn(7);
await onlyInFront(8);
await generatorAtItsYield(9);
await asyncGeneratorAtItsYield(10);
