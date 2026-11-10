// A literal with the names in another order, a getter for the bits that counts, and undefined come through casts.
// STATISTIC: HeadsCopiedWhoseQuestionWasAskedAbove >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Notes { marks: number; kind: string | undefined; constructor(marks: number) { this.marks = marks; this.kind = undefined; } }
class Item { bits: number; id: number; notes: Notes | undefined; constructor(bits: number, id: number) { this.bits = bits; this.id = id; this.notes = bits & 32 ? new Notes(id & 3) : undefined; } }
const shelf: Notes[] = [];
function marksOf(item: Item): number { return item.bits & 32 ? item.notes!.marks : 0; }
function notesOf(item: Item): Notes { if (item.bits & 32) return item.notes!; const id = item.id; return shelf[id] ?? (shelf[id] = new Notes(0)); }
function kindBehind(item: Item): string { return notesOf(item).kind || "k"; }
function kindOf(item: Item): string { const marks = marksOf(item); if (marks & 2) return "two"; if (marks & 1) return kindBehind(item); return "none"; }
(globalThis as any).kept = [kindOf, notesOf, marksOf, kindBehind];
const asked: typeof kindOf = (globalThis as any).kept[0];
let reads = 0; const sly = { id: 5, notes: new Notes(1), get bits() { reads++; return 32; } };
for (let i = 0; i < 24; i++) tell(() => asked(i % 4 === 1 ? through({ notes: new Notes(3 - (i & 2)), id: i, bits: 32 }) : i % 4 === 2 ? through(sly) : i % 4 === 3 ? through(undefined) : new Item(32, i)));
tell(() => reads);
console.log(said.join(" | "));
