// Both arms of an if store into an object that is made under a try, and the way out of the catch meets them without having come by the object.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Leaf = { text: string };
type Node = { left: Leaf | null; right: Leaf | null };
const kept: Node[] = [];
function give(i: number): Leaf { if (i % 7 === 3) throw new RangeError("none for " + i); return { text: "leaf" + i }; }
function deed(i: number) {
    let told = "nothing";
    try {
        const made: Node = { left: give(i), right: null };
        kept.push(made);
        if (i % 2) made.left = { text: "odd" + i }; else made.right = { text: "even" + i };
        told = "made";
    } catch (error) {
        told = (error as Error).message;
    }
    return told;
}
console.log(deed(0), deed(1), deed(3));
const told: string[] = [];
for (let i = 0; i < 20000; i++) told.push(deed(i));
Bun.gc(true);
console.log(told.filter(text => text !== "made").length, kept.length, JSON.stringify(kept[kept.length - 1]), JSON.stringify(kept[100]));
