// A GC formats the stack of an error early when a function in its frames has died. The stacks here have frames of every kind of function, however it got its name.
type Make = () => unknown;

const errors: Error[] = [];
function keep(): undefined {
  errors.push(new Error("kept"));
}

const key = "computed" + String(errors.length);
const symbol = Symbol("described");
const object = {
  method() { return [keep()]; },
  get getter() { return [keep()]; },
  set setter(_value: unknown) { keep(); },
  [key]() { return [keep()]; },
  [symbol]() { return [keep()]; },
  arrow: () => [keep()],
  async asyncMethod() { return [keep()]; },
  *generator() { yield keep(); },
};
class Base {
  field = keep();
  static created = 0;
  static { Base.created++; }
  static staticMethod() { return [keep()]; }
  #hidden() { return [keep()]; }
  callsHidden() { return [this.#hidden()]; }
}
class Derived extends Base {
  constructor() { super(); }
}
function renamed() { return [keep()]; }
Object.defineProperty(renamed, "name", { value: "renamed by a descriptor" });
function shown() { return [keep()]; }
(shown as any).displayName = "a display name, " + key;
function unnamed() { return [keep()]; }
Object.defineProperty(unnamed, "name", { value: "" });
function numbered() { return [keep()]; }
Object.defineProperty(numbered, "name", { value: 1 });
function hasAccessor() { return [keep()]; }
Object.defineProperty(hasAccessor, "name", { get() { return "never read"; } });
function makeClosure(name: string) {
  const closure = () => [keep()];
  Object.defineProperty(closure, "name", { value: name });
  return closure;
}
function tailCaller() { return keep(); }
function outer() {
  function inner() { return [keep()]; }
  return [inner()];
}
async function awaits() {
  await null;
  return [keep()];
}

const rows: Array<[string, Make]> = [
  ["method", () => [object.method()]],
  ["getter", () => [object.getter]],
  ["setter", () => [(object.setter = 1)]],
  ["computed key", () => [(object as any)[key]()]],
  ["symbol key", () => [object[symbol]()]],
  ["arrow", () => [object.arrow()]],
  ["async method", () => [object.asyncMethod()]],
  ["generator", () => [...object.generator()]],
  ["field initializer", () => [new Base()]],
  ["derived constructor", () => [new Derived()]],
  ["static method", () => [Base.staticMethod()]],
  ["private method", () => { const base = new Base(); errors.pop(); return [base.callsHidden()]; }],
  ["renamed", () => [renamed()]],
  ["display name", () => [shown()]],
  ["empty name", () => [unnamed()]],
  ["name that is a number", () => [numbered()]],
  ["name that is an accessor", () => [hasAccessor()]],
  ["closures of one function", () => [makeClosure("first")(), errors.pop(), makeClosure("second")()]],
  ["bound", () => [renamed.bind(undefined)()]],
  ["tail call", () => [tailCaller()]],
  ["inner function", () => [outer()]],
  ["proxy", () => [new Proxy(shown, {})()]],
  ["Reflect.construct", () => [Reflect.construct(Base, [], Derived)]],
  ["indirect eval", () => [(0, eval)("(function evaluated(keep) { return [keep()]; })")(keep)]],
];

for (const [, make] of rows) {
  // Each row has a caller of its own, whose source is not known at build time. Nothing holds it after the call.
  (new Function("make", "return [make()]; // " + Date.now()) as (make: Make) => unknown)(make);
}
const count = errors.length;
await (new Function("awaits", "return awaits(); // " + Date.now()) as (callee: typeof awaits) => Promise<unknown>)(awaits);

Bun.gc(true);

console.log(count === rows.length, errors.length);
errors.forEach((error, row) => {
  const frames = error.stack!.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""));
  console.log((rows[row]?.[0] ?? "after an await") + ": " + frames.filter(frame => !frame.includes("/")).join(" < "));
});
