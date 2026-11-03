// The shape of a store hook in a typed renderer: two plain functions are bound to objects at every render. Text nobody has seen is handed the two functions: it could have given them properties, so what a bind reads of them (bind, name, length) is known by a test at the bind only.
const unseen = Function("a", "b", process.argv[9] ?? "return typeof a === typeof b ? 1 : 0");
interface Fiber { flags: number; id: number }
interface Inst { value: unknown; getSnapshot: () => unknown }
type Subscribe = (listener: () => void) => () => void;
let currentFiber: Fiber | null = null;
let rerenders = 0;
function changed(inst: Inst): boolean { return inst.getSnapshot() !== inst.value; }
function rerender(fiber: Fiber): void { rerenders += fiber.id; }
function subscribeToStore(fiber: Fiber, inst: Inst, subscribe: Subscribe): () => void { return subscribe(function () { if (changed(inst)) rerender(fiber); }); }
function updateStoreInstance(fiber: Fiber, inst: Inst, nextSnapshot: unknown, getSnapshot: () => unknown): void { inst.value = nextSnapshot; inst.getSnapshot = getSnapshot; if (changed(inst)) rerender(fiber); }
const effects: (() => unknown)[] = [];
function pushEffect(create: () => unknown): void { if (effects.length < 64) effects.push(create); else effects[(effects.length + rerenders) & 63] = create; }
function update(subscribe: Subscribe, getSnapshot: () => unknown, inst: Inst): unknown {
  const fiber = currentFiber as Fiber;
  const next = getSnapshot();
  pushEffect(subscribeToStore.bind(null, fiber, inst, subscribe));
  if (inst.getSnapshot !== getSnapshot || (fiber.flags & 1)) { fiber.flags |= 2048; pushEffect(updateStoreInstance.bind(null, fiber, inst, next, getSnapshot)); }
  return next;
}
let state = 0;
const listeners: (() => void)[] = [];
const subscribe: Subscribe = listener => { listeners.push(listener); return () => { listeners.pop(); }; };
let sum = 0;
for (let i = 0; i < 20000; i++) {
  currentFiber = { flags: i & 1, id: i };
  const inst: Inst = { value: state, getSnapshot: () => state };
  sum += update(subscribe, () => state, inst) as number;
  if ((i & 255) === 0) { state++; for (const effect of effects) { const undo = effect(); if (typeof undo === "function") undo(); } for (const l of listeners) l(); }
}
console.log(sum, rerenders, effects.length, unseen(subscribeToStore, updateStoreInstance));
