interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
let struck: Kind | undefined;
const striker: any = [{ valueOf() { if (struck) (struck as Whole).part = other; return 1; } }, 1][JSON.parse('0')];
function idOf(kind: Kind): number | undefined { struck = kind; const was = (kind as Whole).part; const sum = kind.flags + striker; return was && (kind as Whole).part.id + sum; }
function both(a: Kind, b: Kind): string { return String(idOf(a)) + " " + String(idOf(b)); }
(globalThis as any).handed = [both];
const asked: (a: Kind, b: Kind) => string = (globalThis as any).handed[0];
function ask(a: any, b: any) { try { tell(asked(a, b)); } catch (error) { tell("threw " + (error as Error).name); } }
for (let turn = 0; turn < 4; turn++) { const bare = new Kind(4); const full = new Kind(4); (full as Whole).part = part; ask(bare, full); ask(full, bare); ask(full, full); }
console.log(lines.join("\n"));
export {};
