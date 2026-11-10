// STATISTIC: CopiesWalkedWhereTheirGuardsFail >= 1
// Under: --aot-testing=CheckEffectsAtRunTime: where the second walk begins the copy has done nothing that anybody sees
// Under: --aot-check=Validate: the verifier reads both walks
// Under: --aot-harden=proof-checks: what the second walk leans on is asked at the run
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const build = (i: number): Row => { const out: Record<string, unknown> = {}; for (const [key, value] of [["id", i], ["name", "n" + i], ["email", "e" + i + "@x"], ["active", i % 3 === 0], ["score", i * 1.5]] as [string, unknown][]) out[key] = value; return out as unknown as Row; };
const written: Row[] = [{ id: 100, name: "w", email: "w@x", active: true, score: 0.5 }];
// A subclass goes through the same constructor: its objects are its own, with its own field behind the base's.
const rows: Row[] = Array.from({ length: 8 }, (_, i) => build(i));
class User { id: number; name: string; email: string; active: boolean; score: number; constructor(row: Row) { this.id = row.id; this.name = row.name; this.email = row.email; this.active = row.active; this.score = row.score; } }
class Admin extends User { level: number; constructor(row: Row) { super(row); this.level = row.id * 2; } }
const use = (row: Row): number => { const u = new User(row); return u.id + u.name.length + u.email.length + (u.active ? 1 : 0) + u.score; };
const raise = (row: Row): number => { const a = new Admin(row); return a.id + a.level + a.name.length + (a instanceof User ? 100 : 0); };
function total(list: Row[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use(list[i]!) + raise(list[i]!); return s; }
console.log(total(rows), total(written), Object.keys(new Admin(rows[1]!)).join());
