// Between the two questions the bits are cleared: the copy asks for itself, so the answer is the callee's.
// STATISTIC: PartialInlinesAfterDominatingTests >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Notes { marks: number; kind: string | undefined; constructor(marks: number) { this.marks = marks; this.kind = undefined; } }
class Item { bits: number; id: number; notes: Notes | undefined; constructor(bits: number, id: number) { this.bits = bits; this.id = id; this.notes = bits & 32 ? new Notes(id & 3) : undefined; } }
const shelf: Notes[] = [];
function marksOf(item: Item): number { return item.bits & 32 ? item.notes!.marks : 0; }
function notesOf(item: Item): Notes { if (item.bits & 32) return item.notes!; const id = item.id; return shelf[id] ?? (shelf[id] = new Notes(0)); }
function kindOf(item: Item, clears: boolean): string { if (item.bits & 32) { if (clears) item.bits = 0; const notes = notesOf(item); return notes.kind || (notes.kind = "k" + item.id); } return "none"; }
(globalThis as any).kept = [kindOf, notesOf];
const asked: typeof kindOf = (globalThis as any).kept[0];
let sum = ""; for (let i = 0; i < 60; i++) sum += asked(new Item(32, i % 7), i % 3 === 0) + ",";
tell(() => sum); tell(() => shelf.filter(Boolean).length);
console.log(said.join(" | "));
