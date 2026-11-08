import {
  type Draft,
  applyPatches,
  createDraft,
  current,
  enableMapSet,
  enablePatches,
  finishDraft,
  freeze,
  isDraft,
  original,
  produce,
  produceWithPatches,
} from "immer";

enablePatches();
enableMapSet();
interface Todo {
  title: string;
  done: boolean;
  tags: string[];
}
const base: readonly Todo[] = [
  { title: "Learn TypeScript", done: true, tags: [] },
  { title: "Try Immer", done: false, tags: ["a"] },
];
const next = produce(base, draft => {
  draft[1].done = true;
  draft.push({ title: "Tweet about it", done: false, tags: [] });
});
console.log(
  base.length,
  next.length,
  base[1].done,
  next[1].done,
  base[0] === next[0],
  base[1] === next[1],
  Object.isFrozen(next),
  Object.isFrozen(next[1].tags),
);
const [patched, patches, inverse] = produceWithPatches(base, draft => {
  draft[0].tags.push("x");
  draft.splice(1, 1);
});
console.log(
  JSON.stringify(patches),
  JSON.stringify(inverse),
  JSON.stringify(applyPatches(patched, inverse)) === JSON.stringify(base),
);
try {
  (next as Todo[]).push(base[0]);
} catch (error) {
  console.log((error as Error).name);
}
const toggle = produce((draft: Draft<Todo>, done: boolean) => {
  draft.done = done;
});
const draft = createDraft({ map: new Map([["a", { n: 1 }]]), set: new Set([1]) });
draft.map.get("a")!.n++;
draft.set.add(2);
console.log(
  toggle(base[1], true).done,
  isDraft(draft),
  original(draft)!.map.get("a")!.n,
  current(draft).map.get("a")!.n,
  [...finishDraft(draft).set].join(),
  produce(base, () => {}) === base,
  Object.isFrozen(freeze({ a: { b: 1 } }, true).a),
);
