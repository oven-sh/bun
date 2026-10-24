// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number; y: string };
class Acc { total = 0; add(n: number): number { this.total += n; return this.total; } get(): number { return this.total; } }
const acc = new Acc();
show("acc", () => acc.add(1) + acc.get());
show("acc-bad", () => { const r = (acc as any).add("x"); return typeof r + r; });
show("acc-after", () => { const r = acc.get(); return typeof r + r + (acc.add(1)); });
