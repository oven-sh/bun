// An object of typed code goes through `any` into another type that it satisfies.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Sub { v: number }
interface Item { id: string; n: number; sub: Sub | null }
const made: Item[] = [{ id: "m", n: 0.5, sub: { v: 1 } }, { id: "m", n: 1, sub: null }];
function bump(x: Item): number { x.n += 1; return x.n }
function kind(x: Item): string { return typeof x.n }
row("(made by typed code)", () => bump(made[0]) + bump(made[1]));
const text = '{"id":"s","n":7,"sub":null}';
interface Twin { id: string; n: number; sub: Sub | null; note?: string }
const madeTwin: Twin = { id: "m", n: 0.5, sub: null, note: "n" };
function twin(x: Twin): number { x.n += 1; return x.n }
row("an object of typed code, through any, into another type that it satisfies", () => { const a: Item = { id: "s", n: 1, sub: null }; const b: Twin = hide(a); twin(b); return a.n + " " + ((a as unknown) === (b as unknown)) + " " + twin(madeTwin) });
