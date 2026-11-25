// `thing` is assigned again between two yields. What it held before is collected while the generator waits at the second.
// Prints what the compiler saves: objects that are collected earlier
const references = [];
const waiting = [];
let sum = 0;
function make(tag) {
  const thing = { tag, pad: new Array(32).fill(tag) };
  references.push(new WeakRef(thing));
  return thing;
}
function* assignedAgain(tag) {
  let thing = make(tag);
  yield 0;
  sum += thing.tag;
  thing = { tag, pad: null };
  yield 1;
  sum += thing.tag;
  yield 2;
}
function start(count) {
  for (let tag = 0; tag < count; tag++) {
    const steps = assignedAgain(tag);
    steps.next();
    steps.next();
    waiting.push(steps);
  }
}
start(200);
for (let round = 0; round < 6; round++) {
  await new Promise(resolve => setTimeout(resolve, 2));
  Bun.gc(true);
}
const gone = references.filter(reference => reference.deref() === undefined).length;
console.log(gone > 100 ? "collected" : "KEPT", waiting.length, sum);
