// STATISTIC: CollectionCallRunsGuardedOnce >= 1
const OUT: unknown[] = [];
class Sym { name: unknown; decl: Sym | undefined; flags: number; constructor(name: unknown, flags: number) { this.flags = flags; this.name = name; this.decl = undefined; } }
function show(table: Map<unknown, Sym>): string { let s = table.size + ":"; for (const [k, v] of table) s += (Object.is(k, -0) ? "-0" : typeof k === "object" ? "obj" : String(k)) + "=" + v.flags + ","; return s; }
let calls = 0;
function bump(s: Sym): unknown { calls++; s.name = "n" + calls; return s.name; }
(globalThis as any).handedToo = bump;
function mixed(table: Map<unknown, Sym>, bases: Sym[]): void {
  for (const base of bases) {
    table.set(base.name, base);
    table.set((base.name = base.flags), base);
    table.set(base.name, base);
    table.set(bump(base), base);
    table.set(base.name, base);
    table.set(base.name, base);
  }
}
(globalThis as any).handed = mixed;
const t = new Map<unknown, Sym>();
mixed(t, [new Sym("a", 1), new Sym("b", 2)]);
OUT.push(show(t), calls);
console.log(OUT.join(" | "));
