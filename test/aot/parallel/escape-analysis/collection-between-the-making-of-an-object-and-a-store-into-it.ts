// The collector runs between the making of an object and a store into it, and what is stored is held by nothing else.
// A store that lacks its barrier shows in a YOUNG collection alone: a full one, as Bun.gc(true) makes it, finds what is stored through the object. So every twentieth allocation that finds no cell at hand makes a young one.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Node = { name: string; next?: { text: string } };
function deed(i: number) { const node: Node = { name: "node" + i }; Bun.gc(true); node.next = { text: "next" + i }; return node; }
console.log(JSON.stringify(deed(0)));
const kept: Node[] = [];
for (let i = 0; i < 40; i++) kept.push(deed(i));
const filler: object[] = [];
for (let i = 0; i < 20000; i++) filler.push({ i, text: "filler" + i });
Bun.gc(true);
console.log(kept.map(node => node.next!.text).join(), filler.length);
console.log(JSON.stringify(deed(41)));
