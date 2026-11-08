// COUNTER: FieldsLeftSlotByStoreOfOtherType <= 8
// `this.parent = undefined!`, `found!`: the checker is told that a value is there, and undefined or null arrives where a class, a number, a text and a boolean are written. Both lie in the slot of every held type: no field leaves its slot.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class TreeNode {
  parent: TreeNode;
  pos: number;
  text: string;
  open: boolean;
  constructor(pos: number) {
    this.parent = undefined!;
    this.pos = pos;
    this.text = undefined!;
    this.open = null!;
  }
}
function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return (error as Error).name;
  }
}
function show(node: TreeNode): string {
  return attempt(() => node.parent.pos) + " " + (node.pos + 1) + " " + attempt(() => node.text.length) + " " + (node.open ? "open" : "shut") + " " + String(node.open);
}
function find(list: TreeNode[], pos: number): TreeNode | undefined {
  for (let i = 0; i < list.length; i++) {
    if (list[i].pos === pos) return list[i];
  }
  return undefined;
}
const nodes: TreeNode[] = [];
for (let pos = 0; pos < 200; pos++) nodes.push(new TreeNode(pos));
console.log("before", show(nodes[1]));
nodes[1].parent = find(nodes, 7)!;
nodes[1].text = "text";
nodes[1].open = true;
console.log("filled", show(nodes[1]));
nodes[1].parent = find(nodes, 1000)!;
nodes[1].pos = find(nodes, 1000)?.pos!;
console.log("behind", show(nodes[1]));
for (let turn = 0; turn < 3; turn++) {
  const node = new TreeNode(turn);
  node.parent = find(nodes, turn === 1 ? -1 : turn)!;
  console.log(turn, show(node));
}
