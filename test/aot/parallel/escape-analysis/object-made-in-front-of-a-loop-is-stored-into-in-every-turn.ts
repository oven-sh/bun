// An object is made in front of a loop and stored into in every turn, and the turns allocate enough for many collections.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Holder = { name: string; last?: { text: string }; first?: { text: string } };
function deed(turns: number) {
    const holder: Holder = { name: "holder" };
    for (let i = 0; i < turns; i++) {
        holder.last = { text: "turn" + i };
        if (!holder.first) holder.first = holder.last;
    }
    return holder;
}
console.log(JSON.stringify(deed(1)));
console.log(JSON.stringify(deed(300000)));
const kept: Holder[] = [];
for (let i = 1; i < 200; i++) kept.push(deed(i * 10));
Bun.gc(true);
console.log(kept.map(holder => holder.last!.text.length + holder.first!.text.length).join(""));
