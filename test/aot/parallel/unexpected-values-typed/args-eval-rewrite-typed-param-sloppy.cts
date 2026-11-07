// Arguments eval and this rewrite typed parameters in sloppy code.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

function aliased(n: number): number {
  arguments[0] = "text";
  return n + 1;
}

function aliasedBack(n: number): unknown {
  n = 5;
  return arguments[0];
}

function aliasedList(list: number[]): number {
  arguments[0] = "12";
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function aliasedByACallee(n: number, s: string): string {
  spoil(arguments);
  return typeof n + ":" + typeof s + ":" + (n + 1) + ":" + s.length;
}

function spoil(args: IArguments): void {
  args[0] = "zero";
  args[1] = 1;
}

function notAliasedWhenMissing(n?: number): string {
  arguments[0] = "text";
  return typeof n + ":" + arguments.length;
}

function notAliasedWithADefault(n: number = 1): string {
  arguments[0] = "text";
  return typeof n;
}

function shadowedByEval(n: number, text: string): number {
  eval(text);
  return n + 1;
}

function thisOf(this: unknown): string {
  return typeof this + ":" + (this === globalThis);
}

function leaks(): string {
  (function (this: any) {
    this.leakedCount = "leaked";
  })();
  return typeof (globalThis as any).leakedCount;
}

function storesOnAPrimitive(s: string): unknown {
  (s as any).extra = 1;
  return (s as any).extra;
}

function storesOnFrozen(p: { x: number }): number {
  p.x = 9;
  return p.x;
}

function deletes(p: { x?: number }): string {
  return delete p.x + ":" + ("x" in p);
}

function honest(label: string): void {
  console.log(label, shadowedByEval(1, ""), storesOnFrozen({ x: 1 }), deletes({ x: 1 }), notAliasedWithADefault(1), thisOf.call(5));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += shadowedByEval(i, "") + storesOnFrozen({ x: i });
console.log("2000 honest rounds", warm);

attempt("a parameter aliased by arguments", () => aliased(1));
attempt("arguments aliased by a parameter", () => aliasedBack(1));
attempt("a list parameter aliased", () => aliasedList([1, 2]));
attempt("aliased by a callee", () => aliasedByACallee(1, "one"));
attempt("not aliased when the argument is missing", () => [notAliasedWhenMissing(), notAliasedWhenMissing(1)]);
attempt("not aliased with a default", () => [notAliasedWithADefault(), notAliasedWithADefault(1)]);
for (const text of ["n = 'text'", "var n = 'shadow'", "var n", "arguments[0] = 'through arguments'", "n = null", "function n() {}", "n = -0"]) attempt("eval: " + text, () => shadowedByEval(1, text));
attempt("this of a bare call", () => thisOf());
attempt("this of calls with primitives", () => [thisOf.call(5), thisOf.call("s"), thisOf.call(null), thisOf.call(undefined), thisOf.call(true)]);
attempt("a bare call stores on the global object", () => leaks());
attempt("a store on a primitive is dropped", () => storesOnAPrimitive("abc"));
attempt("a store on a frozen object is dropped", () => storesOnFrozen(Object.freeze({ x: 1 })));
attempt("a store over a getter is dropped", () => storesOnFrozen(hidden("{ get x() { return 'got'; } }")));
attempt("a store on null still throws", () => storesOnFrozen(hidden("null")));
attempt("a delete that fails answers false", () => deletes(Object.freeze({ x: 1 })));
attempt("an undeclared name is created by a store", () => {
  eval("undeclaredName = 5");
  return typeof (globalThis as any).undeclaredName;
});
attempt("a function declared in a block", () => {
  const before = typeof (eval("typeof inBlock") as string);
  {
    function inBlock(): number {
      return 1;
    }
    inBlock();
  }
  return before;
});
attempt("duplicate parameter values by apply", () => (aliased as any).apply(undefined, hidden("{ length: 1, 0: 1 }")));

honest("honest after");

module.exports = {};
