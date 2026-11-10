// STATISTIC: EmptySlotCasesEmitted = 1
class Kind { flags: number; up: Kind | undefined; constructor(flags: number, up?: Kind) { this.flags = flags; this.up = up; } }
interface Whole extends Kind { part: Kind }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
let deed: (() => void) | undefined;
function above(kind: Kind): Kind | undefined { if (deed && kind.flags & 8) { const done = deed; deed = undefined; done(); } return kind.up; }
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
const part = new Kind(32);
function chain(): Kind { return new Kind(1, new Kind(9, new Kind(3, end))); }
const full = new Kind(1, end);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(chain()); ask(full); ask(new Kind(turn)); }
deed = () => { Object.defineProperty(Kind.prototype, "part", { get() { return part; }, configurable: true }); };
for (let turn = 0; turn < 3; turn++) { ask(chain()); ask(full); ask(new Kind(1)); }
console.log(lines.join("\n"));
export {};
