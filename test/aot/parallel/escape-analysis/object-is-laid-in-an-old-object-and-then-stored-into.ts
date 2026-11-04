// A new object is laid in an old one that the collector has marked, and is stored into behind that, with nothing between that may collect.
// Only a collector that marks WHILE the program runs finds the new object between the two stores, so one marks all the time, and the verifier asks at the end of each collection whether all that can be reached is marked.
// Env of the executable: BUN_JSC_collectContinuously=1
// Env of the executable: BUN_JSC_verifyGC=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Leaf = { text: string };
type Node = { name: string; leaf?: Leaf };
type Root = { node: Node | null };
const roots: Root[] = [];
for (let i = 0; i < 3000; i++) roots.push({ node: null });
Bun.gc(true);
function deed(root: Root, leaf: Leaf, i: number) { const node: Node = { name: "node" + i }; root.node = node; node.leaf = leaf; return node.name; }
function leafOf(i: number): Leaf { return { text: "leaf" + i }; }
console.log(deed(roots[0], leafOf(0), 0), roots[0].node!.leaf!.text);
let letters = 0;
for (let turn = 0; turn < 30; turn++) {
    for (let i = 0; i < roots.length; i++) deed(roots[i], leafOf(i + turn), i);
    for (let i = 0; i < roots.length; i++) letters += roots[i].node!.leaf!.text.length;
}
Bun.gc(true);
console.log(letters, roots[2999].node!.leaf!.text, roots[17].node!.name);
