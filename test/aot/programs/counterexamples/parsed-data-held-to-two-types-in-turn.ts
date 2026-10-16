// Parsed JSON is held to two types whose required members differ.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Sub { v: number }
interface Left { id: string; n: number; k?: number; sub: Sub | null }
interface Right { id: string; k: number; n?: number; sub: Sub | null }
const madeLeft: Left = { id: "m", n: 0.5, sub: { v: 1 } }; const madeRight: Right = { id: "m", k: 0.5, sub: null };
function left(x: Left): number { x.n += 1; return x.n }
function right(x: Right): number { x.k += 1; return x.k }
row("(made by typed code)", () => left(madeLeft) + right(madeRight));
row("plain data held to two types in turn", () => { const raw = parse('{"id":"s","n":7,"k":9,"sub":null}'); const a: Left = raw; const b: Right = raw; right(b); left(a); return raw.k + " " + raw.n + " " + a.k + " " + b.n + " " + ((a as unknown) === (b as unknown)) });
