// `console` and `console.log` can be replaced by the program, and code that captured the old value keeps it.
/// <reference path="./decl.d.ts" />
const out = { print: console.log };
const original = out.print;
function row(name: string, ...values: unknown[]) { out.print(name + ": " + values.join(" ")); }
const seen: string[] = [];
const quiet = (...values: unknown[]) => { seen.push(String(values[0])); };
function state() { const text = (console.log === original ? "the original" : console.log === quiet ? "the replacement" : "something else") + " [" + seen.join() + "]"; seen.length = 0; return text; }

const atTopLevel = console.log;
console.log = quiet;
console.log("hidden 1");
row("const at the top level: is what it was initialized with", atTopLevel === original, "is what console.log is now", atTopLevel === console.log);
console.log = atTopLevel;
row("const at the top level: behind the store", state());

let withLet = console.log;
console.log = quiet;
console.log("hidden 2");
row("let: is what it was initialized with", withLet === original);
console.log = withLet;
row("let: behind the store", state());

function silence<T>(f: () => T): T { const saved = console.log; console.log = quiet; try { return f(); } finally { console.log = saved; } }
row("in a function, try and finally: the result", silence(() => { console.log("hidden 3"); return 3; }));
row("in a function, try and finally: behind it", state());

function asReactDoes() {
  const previous = console.log;
  const off = { configurable: true, enumerable: true, writable: true, value: quiet };
  Object.defineProperties(console, { log: off });
  console.log("hidden 4");
  const differs = console.log !== previous;
  Object.defineProperties(console, { log: { ...off, value: previous } });
  return differs;
}
row("Object.defineProperties: console.log !== previous behind the first", asReactDoes());
row("Object.defineProperties: behind the second", state());

function orElse() { const saved = console.log || quiet; console.log = quiet; console.log("hidden 5"); const same = saved === original; console.log = saved; return same; }
row("console.log || other: is what it was initialized with", orElse());
row("console.log || other: behind the store", state());

function ifFunction() { const saved = typeof console.log === "function" ? console.log : quiet; console.log = quiet; console.log("hidden 6"); const same = saved === original; console.log = saved; return same; }
row("typeof console.log === \"function\" ? console.log : other: is what it was initialized with", ifFunction());
row("typeof ..: behind the store", state());

function calledWhileReplaced() { const saved = console.log; console.log = quiet; saved("printed by the saved function while console.log is replaced"); console.log = saved; }
calledWhileReplaced();
row("the saved function called while console.log is replaced", state());

function wraps() { const inner = console.log; console.log = (...values: unknown[]) => { inner("[wrapped]", ...values); }; console.log("through the wrapper"); console.log = inner; }
wraps();
row("a wrapper that calls what it has saved", state());

const floor = Math.floor;
const hasOwn = Object.prototype.hasOwnProperty;
row("functions that cannot be replaced, held by constants", floor(2.5), hasOwn.call({ a: 1 }, "a"), hasOwn.call({ a: 1 }, "b"));
console.log("printed by console.log at the end");
