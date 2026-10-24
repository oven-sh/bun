// Plain objects whose properties hold newly allocated strings, arrays, functions and typed objects are used as record types, as they are, while other allocations go on. Everything they hold is still there afterwards.
type Leaf = { n: number; up: Leaf | null };
type Branch = { id: number; label: string; leaf: Leaf; list: number[]; act: () => number; note: unknown };

function typedLeaf(n: number, up: Leaf | null): Leaf {
  return { n, up };
}
function typedBranch(): Branch {
  return { id: 0, label: "typed", leaf: typedLeaf(0, null), list: [0], act: () => 0, note: null };
}
function check(branch: Branch, i: number): number {
  if (branch.id !== i || branch.label !== "label " + i || branch.leaf.n !== i || branch.leaf.up!.n !== i + 1 || branch.list.length !== 3 || branch.list[2] !== i || branch.act() !== i * 2) return 0;
  const note = branch.note as { text: string };
  return note.text === "note " + i ? 1 : 0;
}
function grow(i: number): any {
  const branch: any = { id: i };
  branch.label = "label " + i;
  branch.leaf = typedLeaf(i, typedLeaf(i + 1, null));
  branch.list = [1, 2, i];
  branch.act = () => i * 2;
  branch.note = { text: "note " + i };
  return branch;
}

let good = check({ ...typedBranch(), id: 5, label: "label 5", leaf: typedLeaf(5, typedLeaf(6, null)), list: [1, 2, 5], act: () => 10, note: { text: "note 5" } }, 5);
const kept: any[] = [];
for (let i = 0; i < 2000; i++) {
  const shared = grow(i);
  kept.push(shared);
  good += check(shared, i);
  const fresh: any = { id: i, label: "label " + i, leaf: typedLeaf(i, typedLeaf(i + 1, null)), list: [1, 2, i], act: () => i * 2, note: { text: "note " + i } };
  good += check(fresh, i);
}
for (let i = 0; i < kept.length; i++) {
  good += check(kept[i], i);
  if (kept[i].label !== "label " + i || kept[i].list[2] !== i || kept[i].note.text !== "note " + i || Object.keys(kept[i]).join() !== "id,label,leaf,list,act,note") good = -1000000;
}
console.log(good);
