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
let reads = 0;
const bare = new Sym("gone", 1); delete (bare as any).name;
Object.defineProperty(Sym.prototype, "name", { get() { reads++; return "above" + reads; }, configurable: true });
const t = new Map<unknown, Sym>();
add(t, [new Sym("a", 1), bare, new Sym("b", 2)]);
OUT.push(show(t), reads);
console.log(OUT.join(" | "));
