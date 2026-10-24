// Functions with a written result type call, in tail position, a function value that nobody knows. A chain of such calls of any length runs in constant space, and its result is tested once,
// by whoever receives it, against the type written on the function that was called from outside. A call that is no tail call is tested like any other, however deep in such a chain it is made.
const deep = 400000;
function attempt(label: string, run: () => unknown): void {
  try { console.log(label, run()); } catch (error) { console.log(label, (error as Error).name); }
}
const hidden: any = globalThis;

type Next<T> = (n: number, acc: T, next: any) => T;
function sumDown(n: number, acc: number, next: Next<number>): number {
  if (n === 0) return acc + 0.5;
  return next(n - 1, acc + n, next);
}
hidden.held = sumDown;
attempt("called by value", () => hidden.held(deep, 0, hidden.held));
attempt("called directly", () => sumDown(deep, 0, hidden.held));
attempt("by a built-in", () => [deep, deep + 1].map(n => hidden.held(n, 0, hidden.held)).join());

function numbers(n: number, other: any, self: any): number {
  if (n === 0) return 1.5;
  return other(n - 1, self, other);
}
function texts(n: number, other: any, self: any): string {
  if (n === 0) return "text";
  return other(n - 1, self, other);
}
hidden.pair = [numbers, texts];
for (const depth of [deep, deep + 1]) {
  for (const first of [0, 1])
    attempt("two written types, " + depth + " from " + first, () => hidden.pair[first](depth, hidden.pair[1 - first], hidden.pair[first]));
}

const untyped: any = function (n: any, other: any, self: any) { "use strict"; return n === 0 ? "untyped" : other(n - 1, self, other); };
hidden.untyped = untyped;
attempt("through untyped code, to a number", () => hidden.pair[0](deep, hidden.untyped, hidden.pair[0]));
attempt("through untyped code, to its own text", () => hidden.pair[0](deep + 1, hidden.untyped, hidden.pair[0]));
attempt("untyped code receives", () => hidden.untyped(deep + 1, hidden.pair[0], hidden.untyped));

function wrong(): any { return "no number"; }
hidden.wrong = wrong;
function once(f: any): number { return f(); }
hidden.once = once;
function inner(n: number, f: any): number {
  if (n === 0) { const kept = hidden.once(f); return kept === "no number" ? 1 : 2; }
  return hidden.inner(n - 1, f);
}
hidden.inner = inner;
attempt("an ordinary call at the end of a chain", () => hidden.inner(deep, hidden.wrong));

class Walker {
  steps = 0;
  walk(n: number, next: any): number { if (n === 0) return this.steps; this.steps++; return next.call(this, n - 1, next); }
}
hidden.walk = Walker.prototype.walk;
attempt("a method through call", () => hidden.walk.call(new Walker(), deep, hidden.walk));
