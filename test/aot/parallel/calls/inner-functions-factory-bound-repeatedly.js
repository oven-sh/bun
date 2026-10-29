// The shape of a store hook in a renderer that is one big factory function: the functions that are bound at every render are declared INSIDE the factory, so they are closures with captures that lie in its scope.
const unseen = Function("a", "b", process.argv[9] ?? "return typeof a === typeof b ? 1 : 0");
function createRenderer(config) {
  let currentFiber = null;
  let rerenders = 0;
  const effects = [];
  function changed(inst) { return inst.getSnapshot() !== inst.value; }
  function rerender(fiber) { rerenders += fiber.id * config.scale; }
  function subscribeToStore(fiber, inst, subscribe) { return subscribe(function () { if (changed(inst)) rerender(fiber); }); }
  function updateStoreInstance(fiber, inst, nextSnapshot, getSnapshot) { inst.value = nextSnapshot; inst.getSnapshot = getSnapshot; if (changed(inst)) rerender(fiber); }
  function pushEffect(create) { if (effects.length < 64) effects.push(create); else effects[(effects.length + rerenders) & 63] = create; }
  function update(subscribe, getSnapshot, inst) {
    const fiber = currentFiber;
    const next = getSnapshot();
    pushEffect(subscribeToStore.bind(null, fiber, inst, subscribe));
    if (inst.getSnapshot !== getSnapshot || (fiber.flags & 1)) { fiber.flags |= 2048; pushEffect(updateStoreInstance.bind(null, fiber, inst, next, getSnapshot)); }
    return next;
  }
  return { update, effects, begin(fiber) { currentFiber = fiber; }, count() { return rerenders; }, seen() { return unseen(subscribeToStore, updateStoreInstance); } };
}
const renderer = createRenderer({ scale: 1 });
let state = 0;
const listeners = [];
const subscribe = listener => { listeners.push(listener); return () => { listeners.pop(); }; };
let sum = 0;
for (let i = 0; i < 20000; i++) {
  renderer.begin({ flags: i & 1, id: i });
  const inst = { value: state, getSnapshot: () => state };
  sum += renderer.update(subscribe, () => state, inst);
  if ((i & 255) === 0) { state++; for (const effect of renderer.effects) { const undo = effect(); if (typeof undo === "function") undo(); } for (const l of listeners) l(); }
}
console.log(sum, renderer.count(), renderer.effects.length, renderer.seen());
