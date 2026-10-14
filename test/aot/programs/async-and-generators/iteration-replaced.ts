// `for..of` over user-defined iterators whose `next` or `Symbol.iterator` method is replaced while the program runs.
declare const console: { log(...v: unknown[]): void };
class Steps { i = 0; constructor(public n: number) {} next(): { value: number, done: boolean } { const at = this.i++; return { value: at, done: at >= this.n }; } }
class Range { constructor(public n: number) {} [Symbol.iterator](): Steps { return new Steps(this.n); } }
function sum(r: Range): number { let s = 0; for (const x of r) s += x; return s; }
function swapInLoop(r: Range): number { let s = 0; for (const x of r) { try { (Steps.prototype as any).next = function (this: Steps) { return { value: 500, done: this.i++ > 4 }; }; } catch (e) { s += 10000; } s += x; } return s; }
console.log("before", sum(new Range(3)));
console.log("in the loop", swapInLoop(new Range(3)));
console.log("behind", sum(new Range(3)));
try { (Range.prototype as any)[Symbol.iterator] = function () { return new Steps(1); }; console.log("iterator replaced"); } catch (e) { console.log("the store throws"); }
console.log("behind that", sum(new Range(3)));
