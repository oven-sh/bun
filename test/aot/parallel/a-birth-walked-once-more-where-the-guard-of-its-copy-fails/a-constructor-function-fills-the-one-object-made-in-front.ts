// STATISTIC: CallsInlinedAfterFailedGuards >= 1
// Under: --aot-testing=CheckEffectsAtRunTime: where the second walk begins the copy has done nothing that anybody sees
// Under: --aot-check=Validate: the verifier reads both walks
// Under: --aot-harden=proof-checks: what the second walk leans on is asked at the run
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const build = (i: number): Row => { const out: Record<string, unknown> = {}; for (const [key, value] of [["id", i], ["name", "n" + i], ["email", "e" + i + "@x"], ["active", i % 3 === 0], ["score", i * 1.5]] as [string, unknown][]) out[key] = value; return out as unknown as Row; };
const written: Row[] = [{ id: 100, name: "w", email: "w@x", active: true, score: 0.5 }];
// A constructor function: its object is made in front of the copy, once; whichever walk runs fills that one.
const rows: Row[] = Array.from({ length: 8 }, (_, i) => build(i));
interface Plate { id: number; name: string; email: string; active: boolean; score: number }
function Plate(this: Plate, row: Row) { this.id = row.id; this.name = row.name; this.email = row.email; this.active = row.active; this.score = row.score; }
const made: Plate[] = [];
const use = (row: Row): number => { const p: Plate = new (Plate as unknown as new (row: Row) => Plate)(row); made.push(p); return p.id + p.name.length + p.email.length + (p.active ? 1 : 0) + p.score; };
function total(list: Row[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use(list[i]!); return s; }
console.log(total(rows), total(written), total([...written, ...rows]), made.length, new Set(made).size, made.every(p => p instanceof (Plate as unknown as Function)), Object.keys(made[3]!).join());
