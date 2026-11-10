interface Part { id: number }
class Kind { flags: number; plain: number = 1; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: any; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
let alias: any = null;
const box: any[] = [null, null];
function drop(kind: Kind): number { delete (kind as any).part; return 1; }
(globalThis as any).dropper = [drop];
function change(kind: Kind, n: number) { (globalThis as any).dropper[0](kind); }
function idOf(kind: Kind, n: number): any { const held = (kind as Whole).part; change(kind, n); return held ? (kind as Whole).part : 0; }
function both(a: Kind, b: Kind, n: number): string { alias = a; box[0] = a; box[1] = a; return String(show(idOf(a, n))) + " " + String(show(idOf(b, n))); }
function show(x: any) { return x && x.id ? "id" + x.id : typeof x + String(x); }
(globalThis as any).handed = [both];
const asked: (a: Kind, b: Kind, n: number) => string = (globalThis as any).handed[0];
function ask(a: any, b: any, n: number) { try { tell(asked(a, b, n)); } catch (error) { tell("threw " + (error as Error).name); } }
for (let n = 0; n < 8; n++) {
  for (let turn = 0; turn < 3; turn++) {
    const bare = new Kind(4), full = new Kind(4);
    (full as Whole).part = part;
    ask(bare, full, n); ask(full, bare, n); ask(new Kind(turn), full, n);
    (full as Whole).part = part; ask(full, full, n);
    tell(String("part" in full) + show((full as any).part));
  }
}
console.log(lines.join("\n"));
export {};
