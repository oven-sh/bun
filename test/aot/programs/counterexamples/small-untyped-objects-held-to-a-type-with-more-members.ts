// Small objects made by untyped code are held to a type that has optional members besides, and stay the same objects.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string; sub?: string };
function bump(x: Item): number { x.n += 1; return x.n }
function small(n: number): any { return hide({ id: 1, n }) }
const made: Item = { id: 0, n: 0, tag: "t", sub: "s" };
row("a small literal of untyped code, by an annotation", () => { const r = hide((() => { const o: any = {}; o.id = 1; o.n = 1; return o })()); const t: Item = r; bump(t); return r.n + " " + ((t as unknown) === r) });
row("the same, by `as`", () => { const r = Object.assign(Object.create(Object.prototype), { id: 1, n: 1 }); const t = r as Item; bump(t); return r.n + " " + ((t as unknown) === r) });
row("Object.fromEntries", () => { const r: any = Object.fromEntries([["id", 1], ["n", 1]]); const t: Item = r; bump(t); return r.n + " " + ((t as unknown) === r) });
row("a literal of two names made where no type is seen", () => { const r = small(1); const t: Item = r; bump(t); return r.n + " " + ((t as unknown) === r) + " " + made.n });
row("one node of a graph", () => { type Tree = { v: number; kid?: Tree; a?: number; b?: number }; const kid: any = hide(Object.fromEntries([["v", 2]])); const r = parse('{"v":1}'); r.kid = kid; const t: Tree = r; t.kid!.v = 9; t.v = 8; return r.v + " " + kid.v + " " + ((t as unknown) === r) + " " + ((t.kid as unknown) === kid) });
