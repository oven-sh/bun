// STATISTIC: EmptySlotCasesEmitted >= 1
class Kind { flags: number; up: Kind | undefined; constructor(flags: number, up?: Kind) { this.flags = flags; this.up = up; } }
interface Whole extends Kind { part: Kind }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part = new Kind(32);
function above(kind: Kind): Kind | undefined { if (kind.flags & 8 && kind.up) Object.setPrototypeOf(kind.up, { part }); return kind.up; }
function settle(kind: Kind): Kind {
  while (true) {
    const next = kind.flags & 1 ? (kind as Whole).part ? (kind as Whole).part : above(kind) || kind : kind;
    if (next === kind) return next;
    kind = next;
  }
}
(globalThis as any).handed = [settle];
const asked: (kind: Kind) => Kind = (globalThis as any).handed[0];
function ask(kind: any) { try { tell(String(asked(kind).flags)); } catch (error) { tell("threw " + (error as Error).name); } }
const end = new Kind(16);
const full = new Kind(1, end);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(new Kind(1, new Kind(3, end))); ask(new Kind(1, new Kind(9, new Kind(3, end)))); ask(full); ask(new Kind(turn)); }
console.log(lines.join("\n"));
export {};
