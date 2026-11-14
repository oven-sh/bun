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
let sets = 0;
class Counting extends Map<unknown, Sym> { set(k: unknown, v: Sym) { sets++; return super.set(k, v); } }
const own = new Map<unknown, Sym>(); (own as any).set = function (k: unknown, v: Sym) { sets += 100; return Map.prototype.set.call(this, k, v); };
const plain = new Map<unknown, Sym>();
for (const t of [plain, new Counting(), own, plain]) { add(t, [new Sym("a", 1), new Sym("b", 2)]); OUT.push(show(t), sets); }
console.log(OUT.join(" | "));
