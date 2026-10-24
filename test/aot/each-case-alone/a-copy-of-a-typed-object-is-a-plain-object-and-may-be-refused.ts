// A copy of an object of a declared type, made where nothing is declared, is a plain object: it takes any value under any name, and a typed place that gets it later answers as plain Bun does or refuses loudly.
// Here the compiled program may refuse the value with a TypeError at the typed place. The third operand of `t` is what plain Bun answers: that answer and a TypeError print the same text, anything else prints itself.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const show = (v: unknown) => typeof v === "string" ? v : v === undefined || typeof v === "function" || typeof v === "symbol" ? typeof v : JSON.stringify(v);
function t(name: string, f: () => unknown, plain: string) { let r; try { r = show(f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r === plain || r === "threw TypeError" ? "the answer of plain Bun or a TypeError" : r); }
const never = process.argv.length > 99;
const unseen = eval;
const through = (v: unknown): any => { (globalThis as any).handed = v; return unseen("handed"); };
const copy = (p: any): any => ({ ...p });
type P = { x: number; y: number };
class C { x = 1; y = 2; sum() { return this.x + this.y; } }
const sum = (p: P) => p.x + p.y;
t("the copy with a text arrives at a typed place", () => { const s: P = { x: 1, y: 2 }; const c = copy(through(s)); c.x = "text"; return sum(c as P); }, "text2");
