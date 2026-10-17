// Computed member keys use static private names of the class that is being defined, with type annotations.
declare const console: { log(...a: unknown[]): void };
declare const JSON: { parse(s: string): any };
function said(f: () => unknown): string { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + (e as Error).name; } }
const lines: string[] = [];
function row(label: string, f: () => unknown): string { lines.push(label + ": " + said(f)); return "k" + lines.length; }
const o: any = JSON.parse("{}");
const later: any[] = [];
class Field { static #f = 1; [row("a field read of another object", () => o.#f)]() {} [row("a field stored to another object", () => (o.#f = 2))]() {} [row("in, a field", () => #f in o)]() {} }
class Method { static #m() { return 7; } [row("in, a method", () => #m in o)]() {} [row("in, of what is no object", () => #m in (1 as any))]() {} [(later.push((x: any) => x.#m, (x: any) => #m in x), "k")]() {} static self() { return Method; } }
class Accessor { static get #g() { return 8; } static set #g(v: number) {} [row("in, an accessor", () => #g in o)]() {} [(later.push((x: any) => x.#g, (x: any) => (x.#g = 1)), "k")]() {} }
class Behind { [row("ahead of the declaration of the name", () => #f in o)]() {} [row("read ahead of it", () => o.#f)]() {} static #f = 1; }
class Both { static #s = 1; #i = 2; [row("an instance name beside", () => o.#i)]() {} [row("and the static one", () => o.#s)]() {} static has(x: any) { return (#s in x) + " " + (#i in x); } }
class Heir extends Field { static #h = 1; [row("in an heir", () => (#h in o) + " " + (#h in Field))]() {} }
const Expr = class { static #e = 1; [row("in a class expression", () => #e in o)]() {} static has(x: any) { return #e in x; } };
{ class Block { static #b = 1; [row("in a block", () => (#b in o))]() {} } }
row("the methods are there", () => Object.getOwnPropertyNames(Field.prototype).join());
row("an arrow made in a key, called later: a method", () => said(() => later[0](Method)) + " " + said(() => later[0](o)) + " " + later[1](Method) + " " + later[1](o));
row("an arrow made in a key, called later: an accessor", () => said(() => later[2](Accessor)) + " " + said(() => later[2](o)) + " " + said(() => later[3](Accessor)) + " " + said(() => later[3](o)));
row("behind the declaration", () => Both.has(Both) + " " + Both.has(new Both()) + " " + Both.has(o) + " " + Expr.has(Expr) + " " + Expr.has(o));
for (const line of lines) console.log(line);
