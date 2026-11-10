// STATISTIC: CopiesWalkedWhereTheirGuardsFail >= 1
import { heapStats } from "bun:jsc";
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const build = (i: number): Row => { const out: Record<string, unknown> = {}; for (const [key, value] of [["id", i], ["name", "n" + i], ["email", "e" + i + "@x"], ["active", i % 3 === 0], ["score", i * 1.5]] as [string, unknown][]) out[key] = value; return out as unknown as Row; };
const written: Row[] = [{ id: 100, name: "w", email: "w@x", active: true, score: 0.5 }];
// The births of the second walk are let go like any others: ten times the turns leave no more objects alive.
const rows: Row[] = [...Array.from({ length: 8 }, (_, i) => build(i)), ...written];
class User { id: number; name: string; email: string; active: boolean; score: number; constructor(row: Row) { this.id = row.id; this.name = row.name; this.email = row.email; this.active = row.active; this.score = row.score; } }
let last: User | undefined;
const use = (row: Row): number => { const u = new User(row); last = u; return u.id + u.name.length + u.email.length + (u.active ? 1 : 0) + u.score; };
function total(list: Row[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += use(list[i]!); return s; }
const alive = (turns: number): number => { let s = 0; for (let t = 0; t < turns; t++) s += total(rows); Bun.gc(true); Bun.gc(true); return s > 0 ? heapStats().objectCount : -1; };
alive(2000);
const few = alive(2000), many = alive(20000);
console.log(total(rows), last!.name, many - few < 500);
