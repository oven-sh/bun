// A FinalizationRegistry that a function makes, registers objects with and never mentions again is alive until the job that made it has ended: a collection in that job sees the objects dead and the registry alive, so the callback runs.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
let called = 0;
function make(i: number) {
  return { big: new Array(10).fill(i) };
}
async function usedByANestedFunction() {
  const registry = new FinalizationRegistry(() => {
    called++;
  });
  function register(i: number) {
    const target = make(i);
    registry.register(target, i);
    return { i };
  }
  const kept = register(0);
  for (let i = 1; i < 5; i++) register(i);
  Bun.gc(true);
  await Bun.sleep(1);
  Bun.gc(true);
  return kept.i;
}
async function usedByTheFunctionItself() {
  const registry = new FinalizationRegistry(() => {
    called++;
  });
  for (let i = 0; i < 5; i++) registry.register(make(i), i);
  Bun.gc(true);
  await Bun.sleep(1);
}
function notAsync() {
  const registry = new FinalizationRegistry(() => {
    called++;
  });
  for (let i = 0; i < 5; i++) registry.register(make(i), i);
  Bun.gc(true);
}
// Nothing holds these registries once `register` has returned. A collection may take them together with their objects, so whether a callback runs is left open.
function neverStored() {
  for (let i = 0; i < 5; i++) {
    new FinalizationRegistry(() => {
      called++;
    }).register(make(i), i);
  }
  Bun.gc(true);
}
for (const f of [usedByANestedFunction, usedByTheFunctionItself, notAsync]) {
  called = 0;
  await f();
  await Bun.sleep(1);
  console.log(f.name + ":", called > 0);
}
neverStored();
await Bun.sleep(1);
console.log("neverStored: done");
