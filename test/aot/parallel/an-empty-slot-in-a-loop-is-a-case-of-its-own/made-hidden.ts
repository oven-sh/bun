// STATISTIC: EmptySlotsTakenAsCases = 1
interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
function use(kind: Kind): string { if ((kind as Whole).part) return "has " + (kind as Whole).part.id; return "none"; }
function useEach(kinds: Kind[]): string { let said = ""; for (let at = 0; at < kinds.length; at++) said = use(kinds[at]); return said; }
(globalThis as any).handed = [useEach];
const asked: (kinds: Kind[]) => string = (globalThis as any).handed[0];
function ask(kind: any) { try { tell(asked([kind])); } catch (error) { tell("threw " + (error as Error).name); } }
const bare = new Kind(4);
const full = new Kind(4);
(full as Whole).part = part;
for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(turn)); }
try { Object.defineProperty(bare, "part", { value: part, writable: true, configurable: true, enumerable: false }); } catch (error) { tell("the deed threw " + (error as Error).name); }
for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(4)); }
console.log(lines.join("\n"));
export {};
