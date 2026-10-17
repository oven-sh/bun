// One object is held to two types that it satisfies, in turn and through a union.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type A = { id: number; n: number; a?: string };
type B = { id: number; n: number; b?: string };
function bumpA(x: A): number { x.n += 1; return x.n }
function bumpB(x: B): number { x.n += 1; return x.n }
row("plain data held to two types in turn", () => { const r = parse('{"id":1,"n":1}'); const a: A = r; const b: B = r; bumpA(a); bumpB(b); return r.n + " " + a.n + " " + b.n + " " + ((a as unknown) === (b as unknown)) });
row("a literal of typed code, through any, into another type that it satisfies", () => { const a: A = { id: 1, n: 1 }; const b: B = hide(a); bumpB(b); return a.n + " " + ((a as unknown) === (b as unknown)) });
row("the same through a union", () => { const a: A = { id: 1, n: 1 }; const u: A | B = hide(a); u.n += 1; return a.n });
