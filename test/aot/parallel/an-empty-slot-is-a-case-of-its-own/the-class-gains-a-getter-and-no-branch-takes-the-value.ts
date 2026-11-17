// STATISTIC: EmptySlotCasesEmitted = 1
interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
const kept: any[] = [];
function take(kind: Kind): any { const flags = kind.flags; const found = (kind as Whole).part; kept.push(flags); return found; }
const shelf: any = JSON.parse("{}");
shelf.taken = [take];
const takeOf: (kind: Kind) => any = shelf.taken[0];
function use(kind: Kind): string { const found = takeOf(kind); return found === undefined ? "none" : found === null ? "null" : typeof found === "object" ? "has " + found.id : "odd " + String(found); }
shelf.Kind = Kind;
shelf.handed = [use];
const asked: (kind: Kind) => string = shelf.handed[0];
function ask(kind: any) { try { tell(asked(kind)); } catch (error) { tell("threw " + (error as Error).name); } }
const bare = new Kind(4);
const full = new Kind(4);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(turn)); }
try { Object.defineProperty(shelf.Kind.prototype, "part", { get() { return part; }, configurable: true }); } catch (error) { tell("the deed threw " + (error as Error).name); }
for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(4)); }
console.log(lines.join("\n"));
export {};
