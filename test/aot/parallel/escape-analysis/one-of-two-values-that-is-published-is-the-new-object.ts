// One of two values is laid in an old object, and it may be the object that was made just now, which is stored into behind that.
// Env of the executable: BUN_JSC_collectContinuously=1
// Env of the executable: BUN_JSC_verifyGC=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Leaf = { text: string };
type Node = { name: string; leaf?: Leaf };
type Root = { node: Node | null };
const roots: Root[] = [];
for (let i = 0; i < 3000; i++) roots.push({ node: null });
const spare: Node = { name: "spare" };
Bun.gc(true);
function deed(root: Root, leaf: Leaf, takesNew: boolean, i: number) { const node: Node = { name: "node" + i }; const chosen = takesNew ? node : spare; root.node = chosen; node.leaf = leaf; return chosen.name; }
function leafOf(i: number): Leaf { return { text: "leaf" + i }; }
console.log(deed(roots[0], leafOf(0), true, 0), deed(roots[1], leafOf(1), false, 1));
let letters = 0;
for (let turn = 0; turn < 30; turn++) {
    for (let i = 0; i < roots.length; i++) deed(roots[i], leafOf(i + turn), i % 5 !== 0, i);
    for (let i = 0; i < roots.length; i++) letters += roots[i].node!.leaf ? roots[i].node!.leaf!.text.length : 1;
}
Bun.gc(true);
console.log(letters, roots[2999].node!.leaf!.text, roots[5].node!.name);
