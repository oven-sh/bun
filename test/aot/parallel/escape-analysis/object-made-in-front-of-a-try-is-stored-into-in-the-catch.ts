// An object is made in front of a try and stored into in the catch, and the error that is thrown is made with much else on the way there.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
type Holder = { name: string; caught?: { text: string } };
class Heavy extends Error { filler: object[] = []; constructor(text: string) { super(text); for (let i = 0; i < 3000; i++) this.filler.push({ i, text }); } }
function deed(i: number, fails: boolean) {
    const holder: Holder = { name: "holder" + i };
    try {
        if (fails) throw new Heavy("heavy" + i);
    } catch (error) {
        holder.caught = { text: (error as Error).message };
    }
    return holder;
}
console.log(JSON.stringify(deed(0, true)), JSON.stringify(deed(0, false)));
const kept: Holder[] = [];
for (let i = 0; i < 300; i++) kept.push(deed(i, i % 3 !== 0));
Bun.gc(true);
console.log(kept.map(holder => holder.caught ? holder.caught.text.length : 0).join(""));
