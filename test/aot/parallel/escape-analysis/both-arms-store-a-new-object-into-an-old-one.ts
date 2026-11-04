// Each arm of an if stores a new object into one old object that the collector has marked, and nothing else holds what is stored.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Leaf = { text: string };
type Node = { left: Leaf | null; right: Leaf | null };
const nodes: Node[] = [];
for (let i = 0; i < 3000; i++) nodes.push({ left: null, right: null });
Bun.gc(true);
function deed(node: Node, goesLeft: boolean, leaf: Leaf) { if (goesLeft) node.left = leaf; else node.right = leaf; return node; }
function leafOf(i: number): Leaf { return { text: "leaf" + i }; }
console.log(JSON.stringify(deed(nodes[0], true, leafOf(0))), JSON.stringify(deed(nodes[0], false, leafOf(1))));
let letters = 0;
for (let turn = 0; turn < 30; turn++) {
    for (let i = 0; i < nodes.length; i++) deed(nodes[i], (i + turn) % 2 === 0, leafOf(i + turn));
    for (let i = 0; i < nodes.length; i++) letters += (nodes[i].left ? nodes[i].left!.text.length : 0) + (nodes[i].right ? nodes[i].right!.text.length : 0);
}
Bun.gc(true);
console.log(letters, JSON.stringify(nodes[2999]), JSON.stringify(nodes[1]));
