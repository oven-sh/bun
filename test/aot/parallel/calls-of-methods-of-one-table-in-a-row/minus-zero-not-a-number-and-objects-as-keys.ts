// STATISTIC: CollectionCallRunsGuardedOnce >= 1
const OUT: unknown[] = [];
class Sym { name: unknown; decl: Sym | undefined; flags: number; constructor(name: unknown, flags: number) { this.flags = flags; this.name = name; this.decl = undefined; } }
function add(table: Map<unknown, Sym>, bases: Sym[]): void {
  for (const base of bases) {
    const seen = table.get(base.name);
    if (!seen || seen.flags > 90) {
      table.set(base.name, base);
      table.set(base.name, base);
    }
  }
}
(globalThis as any).handed = add;
function show(table: Map<unknown, Sym>): string { let s = table.size + ":"; for (const [k, v] of table) s += (Object.is(k, -0) ? "-0" : typeof k === "object" ? "obj" : String(k)) + "=" + v.flags + ","; return s; }
let calls = 0; const key = { valueOf() { calls++; return 1; }, toString() { calls++; return "k"; } };
const t = new Map<unknown, Sym>();
add(t, [new Sym(-0, 1), new Sym(0, 2), new Sym(NaN, 3), new Sym(NaN, 4), new Sym(key, 5), new Sym(key, 6), new Sym(1, 7), new Sym("1", 8), new Sym(undefined, 9), new Sym(null, 10), new Sym(10n, 11), new Sym(Symbol.iterator, 12)]);
OUT.push(show(t), calls, t.has(0), t.has(-0), t.has(NaN), [...t.keys()].some(k => Object.is(k, -0)));
console.log(OUT.join(" | "));
