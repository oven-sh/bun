type Sym = { readonly name: unknown; decl: Sym | undefined; flags: number };
let asked = 0;
const order: string[] = [];
function sym(name: unknown, flags: number): Sym { return { get name() { return name; }, decl: undefined, flags }; }
function counted(name: unknown, flags: number): Sym { return { get name() { asked++; order.push("get " + String(name)); return name; }, decl: undefined, flags }; }
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
function show(table: Map<unknown, Sym>): string { let s = table.size + ":"; for (const [k, v] of table) s += String(k) + "=" + v.flags + ","; return s; }
const plain = new Map<unknown, Sym>();
add(plain, [sym("a", 1), sym("b", 2), sym("c", 3)]);
console.log("SAID has a " + plain.has("a"));
console.log("SAID table " + show(plain));
const told = new Map<unknown, Sym>();
add(told, [counted("a", 1), counted("b", 95), counted("a", 3)]);
console.log("SAID told " + show(told) + " asked " + asked + " in the order " + order.join(" . "));
