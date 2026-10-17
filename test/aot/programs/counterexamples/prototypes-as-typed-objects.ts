// Parsed data and typed objects that are the prototype of another object.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string };
function bump(x: Item): number { x.n += 1; return x.n }
row("what is the prototype of another object", () => { const r = parse('{"id":1,"n":1}'); const heir = Object.create(r); const t: Item = r; bump(t); return r.n + " " + heir.n + " " + ((t as unknown) === r) });
row("a typed object as a prototype", () => { const t: Item = { id: 1, n: 1 }; const heir = Object.create(t); t.n = 5; return heir.n + " " + Object.getPrototypeOf(heir).n + " " + (Object.getPrototypeOf(heir) === t) + " " + ("n" in heir) + " " + Object.keys(heir).length });
row("an heir of a typed object held to the type", () => { const t: Item = { id: 1, n: 1 }; const heir: any = Object.create(t); const u: Item = heir; return bump(u) + " " + t.n + " " + Object.keys(heir).join() });
