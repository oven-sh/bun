// A FinalizationRegistry that the program still holds runs its callback for the objects that were registered with it and are gone: one at module level, one that a function names again behind the collection, one in a field of an object that is read later.
// A registry in a local variable that nothing names again can be collected with its objects, so whether its callback runs is left open.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
let called = 0;
function make(i: number) {
  return { big: new Array(10).fill(i) };
}
const count = () => {
  called++;
};
const atModuleLevel = new FinalizationRegistry(count);
async function heldByTheModule() {
  for (let i = 0; i < 5; i++) atModuleLevel.register(make(i), i);
  Bun.gc(true);
  await Bun.sleep(1);
}
async function namedAgainByANestedFunction() {
  const registry = new FinalizationRegistry(count);
  function register(i: number) {
    registry.register(make(i), i);
  }
  for (let i = 0; i < 5; i++) register(i);
  Bun.gc(true);
  await Bun.sleep(1);
  Bun.gc(true);
  await Bun.sleep(1);
  register(5);
}
async function namedAgainByTheFunctionItself() {
  const registry = new FinalizationRegistry(count);
  for (let i = 0; i < 5; i++) registry.register(make(i), i);
  Bun.gc(true);
  await Bun.sleep(1);
  registry.register(make(5), 5);
}
const holder: { registry?: FinalizationRegistry<number> } = {};
function heldByAField() {
  holder.registry = new FinalizationRegistry(count);
  for (let i = 0; i < 5; i++) holder.registry.register(make(i), i);
  Bun.gc(true);
}
function neverNamedAgain() {
  const registry = new FinalizationRegistry(count);
  for (let i = 0; i < 5; i++) registry.register(make(i), i);
  for (let i = 0; i < 5; i++) new FinalizationRegistry(count).register(make(i), i);
  Bun.gc(true);
}
for (let round = 0; round < 3; round++) {
  for (const f of [heldByTheModule, namedAgainByANestedFunction, namedAgainByTheFunctionItself, heldByAField]) {
    called = 0;
    await f();
    await Bun.sleep(1);
    console.log(f.name + ":", called > 0);
  }
}
console.log(typeof holder.registry);
neverNamedAgain();
await Bun.sleep(1);
console.log("neverNamedAgain: done");
