// A function that waits holds what it reads behind the wait. `thing = null` behind the wait reads nothing.
// Prints what the compiler saves: objects that are collected earlier
class Thing {
  constructor(public id: number) {}
}
let made = 0;
function make(): Thing {
  return new Thing(++made);
}
let used = 0;
function use(thing: Thing) {
  used += thing.id;
}
let ref: WeakRef<Thing>;
function scrub(depth: number, a: number, b: number, c: number): number {
  return depth > 0 ? scrub(depth - 1, b, c, a) + 1 : a + b + c;
}
function says(name: string) {
  scrub(200, 1, 2, 3);
  Bun.gc(true);
  console.log(name + ": " + (ref.deref() === undefined ? "collected" : "KEPT"));
}
async function later(name: string) {
  await Promise.resolve();
  await Promise.resolve();
  says(name);
}

async function behindAnAwait() {
  let thing: Thing | null = make();
  ref = new WeakRef(thing);
  use(thing);
  await later("async, during the await");
  thing = null;
  await later("async, behind the store");
}
async function behindAnAwaitInOneArm(flag: boolean) {
  let thing: Thing | null = make();
  ref = new WeakRef(thing);
  use(thing);
  if (flag) await later("async, during the await in one arm");
  thing = null;
  await later("async, behind the store behind the arm");
}
async function aroundALoop(turns: number) {
  let thing: Thing | null = null;
  for (let turn = 0; turn < turns; turn++) {
    thing = null;
    await later("async, in a loop, behind the store, turn " + turn);
    thing = make();
    ref = new WeakRef(thing);
    use(thing);
    await later("async, in a loop, during the await in front of the store, turn " + turn);
  }
}
async function readAgainBehindTheAwait() {
  let thing: Thing | null = make();
  ref = new WeakRef(thing);
  await later("async, read again behind the await, during it");
  use(thing);
  thing = null;
}
function* behindAYield() {
  let thing: Thing | null = make();
  ref = new WeakRef(thing);
  use(thing);
  yield 1;
  thing = null;
  yield 2;
}

await behindAnAwait();
await behindAnAwaitInOneArm(true);
await behindAnAwaitInOneArm(false);
await aroundALoop(2);
await readAgainBehindTheAwait();
const steps = behindAYield();
steps.next();
await later("a generator, at the yield");
steps.next();
await later("a generator, behind the store");
console.log(used);
