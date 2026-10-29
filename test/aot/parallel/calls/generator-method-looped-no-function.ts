// A loop over the generator that a method returns, and calls of values that are no functions: each throws a TypeError where it stands, behind its arguments, and a handler around it catches it.
declare const console: any;
class Span {
  constructor(public from: number, public to: number) {}
  *items() { for (let k = this.from; k < this.to; k++) yield k; }
  *pairs() { for (let k = this.from; k < this.to; k++) yield [k, k * k] as const; }
}
function sum(span: Span): number { let total = 0; for (const value of span.items()) total += value; return total; }
function sumOfSquares(span: Span): number { let total = 0; for (const [, square] of span.pairs()) total += square; return total; }
function firstOver(span: Span, limit: number): number { for (const value of span.items()) if (value > limit) return value; return -1; }
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(new Span(i & 3, 8)) + sumOfSquares(new Span(0, i & 7)) + firstOver(new Span(0, 10), i & 15);
console.log(total);

const log: string[] = [];
function note(text: string): number { log.push(text); return log.length; }
function attempt(name: string, f: () => unknown) { try { console.log(name + ": " + f()); } catch (e: any) { console.log(name + ": " + e.constructor.name + ", " + log.join(" ")); } log.length = 0; }
const holder: any = { nothing: undefined, none: null, number: 1, text: "t", flag: true, symbol: Symbol("s"), big: 1n };
attempt("undefined", () => holder.nothing(note("a"), note("b")));
attempt("null", () => holder.none(note("a")));
attempt("a number", () => holder.number(note("a")));
attempt("a text", () => holder.text(note("a")));
attempt("a boolean", () => holder.flag(note("a")));
attempt("a symbol", () => holder.symbol(note("a")));
attempt("a bigint", () => holder.big(note("a")));
attempt("a constant", () => (undefined as any)(note("a")));
attempt("in tail position", () => { function f(): unknown { return (undefined as any)(note("t")); } return f(); });
attempt("behind a test", () => { const f: any = log.length > 5 ? () => 1 : undefined; return f(note("x")) + 1; });
attempt("caught inside", () => { try { (null as any)(note("in")); return "not reached"; } catch { return "caught " + log.join(" "); } finally { note("finally"); } });
attempt("a method taken away", () => { const span: any = new Span(0, 3); span.items = undefined; let n = 0; for (const v of span.items()) n += v; return n; });
attempt("a method deleted from the prototype", () => { delete (Span.prototype as any).pairs; return sumOfSquares(new Span(0, 3)); });
attempt("the other method still runs", () => sum(new Span(0, 4)));
