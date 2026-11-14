// STATISTIC: CollectionCallRunsGuardedOnce >= 1
const OUT: unknown[] = [];
class Sym { name: unknown; decl: Sym | undefined; flags: number; constructor(name: unknown, flags: number) { this.flags = flags; this.name = name; this.decl = undefined; } }
function show(table: Map<unknown, Sym>): string { let s = table.size + ":"; for (const [k, v] of table) s += (Object.is(k, -0) ? "-0" : typeof k === "object" ? "obj" : String(k)) + "=" + v.flags + ","; return s; }
function churn(table: Map<unknown, Sym>, bases: Sym[]): number {
  let n = 0;
  for (const base of bases) {
    table.set(base.name, base);
    table.delete(base.name);
    table.set(base.name, base);
    n += table.has(base.name) ? 1 : 0;
    table.set(base.flags, base);
    table.set(base.name, base);
  }
  return n;
}
(globalThis as any).handed = new Function("x", "return x")(churn);
const t = new Map<unknown, Sym>();
OUT.push(churn(t, [new Sym("a", 1), new Sym("b", 2), new Sym("a", 3)]), show(t));
console.log(OUT.join(" | "));
