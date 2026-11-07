// `thing` lives across a yield only on the long way. A generator that took the short way and waits there needs it no more: it is collected while the generator waits.
// Prints what the compiler saves: objects that are collected earlier
// Todo: it stays in the frame of the generator, where it was stored when it was made, until the generator goes
const unseen = x => [x][JSON.parse("0")];
const references = [];
const waiting = [];
function make(tag) {
  const thing = { tag, pad: new Array(32).fill(tag) };
  references.push(new WeakRef(thing));
  return thing;
}
function* onOneWay(tag, long) {
  const thing = make(tag);
  if (long) {
    yield 0;
    yield thing.tag;
  } else {
    yield thing.tag;
    yield 1;
  }
}
function start(count) {
  for (let tag = 0; tag < count; tag++) {
    const steps = onOneWay(tag, unseen(false));
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
console.log(gone > 100 ? "collected" : "KEPT", waiting.length);
