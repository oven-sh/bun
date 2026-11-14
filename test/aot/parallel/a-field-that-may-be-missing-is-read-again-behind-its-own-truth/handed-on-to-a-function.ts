// STATISTIC: SlotsProvenFilledByTruthiness >= 1
const outside: any = JSON.parse("{}");
interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
function pass(part: Part): Part { return part.id & 4 ? { id: part.id | 1 } : part; }
function partOf(kind: Kind): Part | undefined { return (kind as Whole).part && pass((kind as Whole).part); }
function both(a: Kind, b: Kind): string { return String(partOf(a) === partOf(b)) + " " + String(partOf(b) === part); }
outside.handed = [both];
const asked: (a: Kind, b: Kind) => string = outside.handed[0];
function ask(a: any, b: any) { try { tell(asked(a, b)); } catch (error) { tell("threw " + (error as Error).name); } }
const bare = new Kind(4);
const full = new Kind(4);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(bare, full); ask(full, bare); ask(new Kind(turn), full); }
(bare as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(bare, full); ask(full, bare); ask(new Kind(4), full); }
console.log(lines.join("\n"));
export {};
