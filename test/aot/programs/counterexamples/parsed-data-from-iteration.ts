// Parsed JSON under a type is reached through `entries()`, a Map, a Set and `Object.values`.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface Item { id: string; n: number }
const raw = () => JSON.parse('[{"id":"a","n":1},{"id":"b","n":2}]');
row("entries()", () => { const l: Item[] = raw(); let s = 0; for (const [, o] of l.entries()) s += o.n; return s });
row("a Map", () => { const m: Map<string, Item> = hide(new Map(raw().map((o: any) => [o.id, o]))); let s = 0; for (const [, o] of m) s += o.n; return s + m.get("a")!.n });
row("a Set", () => { const t: Set<Item> = hide(new Set(raw())); let s = 0; for (const o of t) s += o.n; return s });
row("Object.values", () => { const d: Record<string, Item> = hide({ a: raw()[0] }); let s = 0; for (const o of Object.values(d)) s += o.n; return s });
