// A build removes text that `bun run` keeps: under a comparison of constants, under what every executable has. A function that is suspended in front of such text holds the locals that it names.
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
const level = 1;

async function underAComparison(n) {
  const x = make(n);
  await pause("named under a comparison of a constant");
  if (level > 3) console.log(x.n);
  return 1;
}
async function inAnElse(n) {
  const x = make(n);
  await pause("named in an else");
  if (level < 3) n++;
  else console.log(x.n);
  return n;
}
async function behindAnd(n) {
  const x = make(n);
  await pause("named behind &&");
  level > 3 && console.log(x.n);
  return 1;
}
async function inAnArmOfAConditional(n) {
  const x = make(n);
  await pause("named in an arm of a conditional");
  return level > 3 ? x.n : 1;
}
async function inALoop(n) {
  const x = make(n);
  await pause("named in the body of a loop");
  while (isVerbose) console.log(x.n);
  return 1;
}
async function whereThereIsNoBun(n) {
  const x = make(n);
  await pause("named where there is no Bun");
  if (typeof Bun === "undefined") console.log(x.n);
  return 1;
}
async function byAClosure(n) {
  const x = make(n);
  await pause("named by a closure");
  if (level > 3) setTimeout(() => console.log(x.n), 1);
  return 1;
}
async function inALaterTurn(n) {
  const x = make(n);
  for (let turn = 0; turn < 2; turn++) {
    if (level > 3) console.log(x.n);
    if (turn === 0) await pause("named in front of the await, in a loop that comes round");
  }
  return 1;
}
async function onlyInFront(n) {
  const x = make(n);
  if (level > 3) console.log(x.n);
  await pause("named only in front of the await");
  return 1;
}
async function underALiteral(n) {
  const x = make(n);
  await pause("named under a literal false");
  if (false) console.log(x.n);
  return 1;
}
function* yields(n) {
  const x = make(n);
  yield 1;
  if (level > 3) console.log(x.n);
}
async function generatorAtItsYield(n) {
  const generator = yields(n);
  generator.next();
  await pause("generator: named under a comparison of a constant");
  return generator.next().done;
}
async function* steps(n) {
  const x = make(n);
  yield 1;
  if (level > 3) console.log(x.n);
}
async function asyncGeneratorAtItsYield(n) {
  const generator = steps(n);
  await generator.next();
  await pause("async generator: named under a comparison of a constant");
  return (await generator.next()).done;
}

await underAComparison(1);
await inAnElse(2);
await behindAnd(3);
await inAnArmOfAConditional(4);
await inALoop(5);
await whereThereIsNoBun(6);
await byAClosure(7);
await inALaterTurn(8);
await onlyInFront(9);
await underALiteral(10);
await generatorAtItsYield(11);
await asyncGeneratorAtItsYield(12);
