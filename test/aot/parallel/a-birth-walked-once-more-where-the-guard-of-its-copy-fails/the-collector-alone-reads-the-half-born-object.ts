// STATISTIC: CallsInlinedAfterFailedGuards >= 1
// Under: --aot-testing=CheckEffectsAtRunTime: where the second walk begins the copy has done nothing that anybody sees
// Under: --aot-check=Validate: the verifier reads both walks
// Under: --aot-harden=proof-checks: what the second walk leans on is asked at the run
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const build = (i: number): Row => { const out: Record<string, unknown> = {}; for (const [key, value] of [["id", i], ["name", "n" + i], ["email", "e" + i + "@x"], ["active", i % 3 === 0], ["score", i * 1.5]] as [string, unknown][]) out[key] = value; return out as unknown as Row; };
const written: Row[] = [{ id: 100, name: "w", email: "w@x", active: true, score: 0.5 }];
// A getter of the row collects while the object is half filled: nobody but the collector looks at it then. What was stored in front must be alive behind it.
const rows: Row[] = Array.from({ length: 8 }, (_, i) => { const row = build(i); let text = "n" + i; Object.defineProperty(row, "score", { get() { const junk: object[] = []; for (let k = 0; k < 200; k++) junk.push({ k, text: text + k }); Bun.gc(true); return i * 1.5 + junk.length; }, enumerable: true }); Object.defineProperty(row, "name", { get() { return ("fresh" + i).repeat(2); }, enumerable: true }); return row; });
class User { id: number; name: string; email: string; active: boolean; score: number; constructor(row: Row) { this.id = row.id; this.name = row.name; this.email = row.email; this.active = row.active; this.score = row.score; } }
const kept: User[] = [];
const use = (row: Row): number => { const u = new User(row); kept.push(u); return u.id + u.name.length + u.email.length + (u.active ? 1 : 0) + u.score; };
function total(list: Row[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use(list[i]!); return s; }
console.log(total(written), total(rows), total([...rows, ...written]), kept.map(u => u.name + ":" + u.score).join());
