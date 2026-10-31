// What a function made and reads no more behind an await is collected while the functions that it awaits wait. Asked from the innermost of them.
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
async function inner(label) {
  await pause(label);
  return 1;
}

async function mapThroughAnotherFunction(n) {
  const holder = new Map([[n, make(n)]]);
  await inner("a map, an awaited call of a function that awaits");
  return 1;
}
async function map(n) {
  const holder = new Map([[n, make(n)]]);
  await pause("a map, an awaited call");
  return 1;
}
async function setThroughAnotherFunction(n) {
  const holder = new Set([make(n)]);
  await inner("a set, an awaited call of a function that awaits");
  return 1;
}
async function localThroughAnotherFunction(n) {
  const x = make(n);
  sink += x.n;
  await inner("a local, an awaited call of a function that awaits");
  return 1;
}
async function mapFilledBySet(n) {
  const holder = new Map();
  holder.set(n, make(n));
  await inner("a map filled by set, an awaited call of a function that awaits");
  return 1;
}
async function listThroughAnotherFunction(n) {
  const holder = [n, make(n)];
  sink += holder.length;
  await inner("a list, an awaited call of a function that awaits");
  return 1;
}

for (let n = 0; n < 1; n++) await mapThroughAnotherFunction(n);
for (let n = 0; n < 1; n++) await map(n);
for (let n = 0; n < 1; n++) await setThroughAnotherFunction(n);
for (let n = 0; n < 1; n++) await localThroughAnotherFunction(n);
for (let n = 0; n < 1; n++) await mapFilledBySet(n);
for (let n = 0; n < 1; n++) await listThroughAnotherFunction(n);
await mapThroughAnotherFunction(1);
await mapFilledBySet(2);
