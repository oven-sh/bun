// STATISTIC: SlotsProvenFilledByTruthiness >= 1
interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
function idOf(kind: Kind): number | undefined { return (kind as Whole).part && (kind as Whole).part.id; }
function both(a: Kind, b: Kind): string { return String(idOf(a)) + " " + String(idOf(b)); }
(globalThis as any).handed = [both];
const asked: (a: Kind, b: Kind) => string = (globalThis as any).handed[0];
function ask(a: any, b: any) { try { tell(asked(a, b)); } catch (error) { tell("threw " + (error as Error).name); } }
const bare = new Kind(4);
const full = new Kind(4);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(bare, full); ask(full, bare); ask(new Kind(turn), full); }
for (const odd of [null, 0, "", false, NaN]) { (full as any).part = odd; ask(full, bare); ask(bare, full); }
for (let turn = 0; turn < 3; turn++) { ask(bare, full); ask(full, bare); ask(new Kind(4), full); }
console.log(lines.join("\n"));
export {};
