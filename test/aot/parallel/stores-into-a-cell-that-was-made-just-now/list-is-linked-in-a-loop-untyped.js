// Each turn makes a link and lays the older links in it. Nothing is written of any type.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
function deed(count, word) { let head = null; for (let i = 0; i < count; i++) { const link = { value: word }; link.next = head; link.first = head ? head.first : link; head = link; } return head; }
function lengthOf(head) { let n = 0; for (let link = head; link; link = link.next) n += link.value.length + link.first.value.length; return n; }
const kept = [];
for (let i = 0; i < 300; i++) kept.push(deed(40, "word" + i));
let letters = 0;
for (let turn = 0; turn < 5; turn++) { for (let i = 0; i < kept.length; i++) letters += lengthOf(kept[i]); for (let i = 0; i < kept.length; i += 4) kept[i] = deed(30 + turn, "turn" + turn); }
console.log(letters, kept[299].next.value, kept[4].value);
