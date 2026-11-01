// The engine's own constructors of errors, called where no `new Error()` is written: Reflect.construct(), Reflect.apply(), a bound constructor, a class below Error, a constructor of the run.
// Their own frame is left out of the stack, which begins at the code that asked.
// Flags: --aot-validate
const shown = (error: unknown) =>
  String((error as Error).stack)
    .split("\n")
    .map(line => line.trim().replace(/[^ (]*[\\/]/, ""))
    .join(" | ");
function deep(depth: number, work: () => unknown): unknown {
  if (depth > 0) {
    const result = deep(depth - 1, work);
    return result === deep ? 0 : result;
  }
  return work();
}
const name: string = process.env.NO_SUCH_NAME ?? "RangeError";
const ofTheRun = (globalThis as any)[name] as ErrorConstructor;
const bound = TypeError.bind(null, "bound") as TypeErrorConstructor;
class Own extends Error {}
class OwnWithConstructor extends SyntaxError {
  constructor(text: string) {
    super(text + "!");
  }
}
function Old(this: any, text: string) {
  return Reflect.construct(Error, [text], new.target ?? Old);
}
Old.prototype = Object.create(Error.prototype);
const forms: [string, () => unknown][] = [
  ["Reflect.construct", () => Reflect.construct(Error, ["a"])],
  ["Reflect.construct with a new target", () => Reflect.construct(Error, ["b"], Own)],
  ["Reflect.apply", () => Reflect.apply(Error, undefined, ["c"])],
  ["call", () => Error.call(undefined, "d")],
  ["apply", () => Error.apply(undefined, ["e"])],
  ["bound, constructed", () => new bound()],
  ["bound, called", () => bound()],
  ["a constructor of the run, constructed", () => new ofTheRun("f")],
  ["a constructor of the run, called", () => ofTheRun("g")],
  ["a class below Error", () => new Own("h")],
  ["a class with a constructor", () => new OwnWithConstructor("i")],
  ["a function that constructs", () => new (Old as any)("j")],
  ["an AggregateError", () => new AggregateError([1], "k")],
  ["a callback of a built-in", () => ["l"].map(Error)[0]],
  ["a callback of a built-in, of the run", () => ["m"].map(ofTheRun)[0]],
];
for (const limit of [10, 0, 1, 2, 40]) {
  Error.stackTraceLimit = limit;
  for (const [form, work] of forms) {
    console.log(limit, form, "at the top:", shown(work()));
    console.log(limit, form, "three deep:", shown(deep(3, work)));
    console.log(limit, form, "thirty deep:", shown(deep(30, work)));
  }
}
