// A variable of the file takes the object: the collector finds it there while the program runs.
// Env of the executable: BUN_JSC_collectContinuously=1
// Env of the executable: BUN_JSC_verifyGC=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Leaf = { text: string };
type Node = { name: string; leaf?: Leaf };
let newest: Node | null = null;
function deed(leaf: Leaf, i: number) { const node: Node = { name: "node" + i }; newest = node; node.leaf = leaf; return node.name.length; }
function leafOf(i: number): Leaf { return { text: "leaf" + i }; }
let letters = 0;
for (let turn = 0; turn < 60000; turn++) { letters += deed(leafOf(turn), turn); if (turn % 7 === 0) letters += newest!.leaf!.text.length; }
console.log(letters, newest!.leaf!.text);
