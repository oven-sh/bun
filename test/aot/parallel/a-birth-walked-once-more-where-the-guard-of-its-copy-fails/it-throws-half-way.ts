// STATISTIC: CallsInlinedAfterFailedGuards >= 1
// Under: --aot-testing=CheckEffectsAtRunTime: where the second walk begins the copy has done nothing that anybody sees
// Under: --aot-check=Validate: the verifier reads both walks
// Under: --aot-harden=proof-checks: what the second walk leans on is asked at the run
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const build = (i: number): Row => { const out: Record<string, unknown> = {}; for (const [key, value] of [["id", i], ["name", "n" + i], ["email", "e" + i + "@x"], ["active", i % 3 === 0], ["score", i * 1.5]] as [string, unknown][]) out[key] = value; return out as unknown as Row; };
const written: Row[] = [{ id: 100, name: "w", email: "w@x", active: true, score: 0.5 }];
// A getter of the row throws behind the first store: the half-born object is dropped, the turn's catch goes on, and nothing of it is seen.
const rows: Row[] = Array.from({ length: 8 }, (_, i) => { const row = build(i); if (i % 3 === 1) Object.defineProperty(row, "name", { get() { throw new RangeError("no name " + i); }, enumerable: true }); return row; });
class User { id: number; name: string; email: string; active: boolean; score: number; constructor(row: Row) { this.id = row.id; this.name = row.name; this.email = row.email; this.active = row.active; this.score = row.score; } }
const use = (row: Row): number => { const u = new User(row); return u.id + u.name.length + u.email.length + (u.active ? 1 : 0) + u.score; };
function total(list: Row[]): string { let s = 0; const said: string[] = []; for (let i = 0; i < list.length; i++) { try { s += use(list[i]!); } catch (error) { said.push((error as Error).message); } } return s + " " + said.join("|"); }
console.log(total(rows), total(written), total([...written, ...rows, ...written]));
