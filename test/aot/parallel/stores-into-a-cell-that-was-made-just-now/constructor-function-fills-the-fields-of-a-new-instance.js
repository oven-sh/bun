// A constructor function of the old kind, copied in behind the allocation or entered: its stores create the fields.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=20
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
function Leaf(text) { this.text = text; }
function Pair(left, right) { this.left = left; this.right = right; this.both = null; this.both = left; }
Pair.prototype.letters = function () { return this.left.text.length + this.right.text.length + this.both.text.length; };
function deed(i) { return new Pair(new Leaf("l" + i), new Leaf("r" + i)); }
const kept = [];
for (let i = 0; i < 4000; i++) kept.push(deed(i));
let letters = 0;
for (let turn = 0; turn < 5; turn++) { for (let i = 0; i < kept.length; i++) letters += kept[i].letters(); for (let i = 0; i < kept.length; i += 7) kept[i] = deed(i + turn); }
console.log(letters, kept[3999].left.text, kept[7].both.text);
