// Constructors that native code, bound functions, proxies and text evaluated at run time call with new see the right new.target, make the right object, and their stack frames say new.
Error.stackTraceLimit = 50;
const lines: string[] = [];
// prettier-ignore
const own = new Set([
  "Base", "Derived", "Other", "Legacy", "Small", "Replaced", "Thrower", "TextBase", "OverText", "TextDerived",
  "List", "Bytes", "Chain", "Pattern",
  "plainNew", "reflectConstruct", "reflectWithTarget", "boundNew", "boundTwice", "reflectBound",
  "proxyNew", "proxyTrap", "textNew", "textSubclassNew",
  "viaBuiltin", "replacedWays", "manySmall", "reflectApply", "textCall",
]);

function show(value: any): string {
  if (typeof value === "string") {
    if (value.length <= 80) return JSON.stringify(value);
    return value.length + ":" + JSON.stringify(value.slice(0, 20)) + ".." + JSON.stringify(value.slice(-20));
  }
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return "[" + Array.from(value as any, show).join(",") + "]";
  if (value instanceof Set) return "Set[" + Array.from(value, show).join(",") + "]";
  if (value instanceof Map) {
    return "Map[" + Array.from(value, ([key, item]) => show(key) + "=>" + show(item)).join(",") + "]";
  }
  return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
}

function frames(error: unknown): string {
  const seen: string[] = [];
  for (const line of String((error as Error).stack).split("\n")) {
    const match = /^\s+at (?:async )?(new )?([\w$]+) \(/.exec(line);
    if (match && own.has(match[2])) seen.push((match[1] ?? "") + match[2]);
  }
  return seen.join(" < ");
}
const nameOf = (value: any): string => (typeof value === "function" ? value.name || "(anonymous)" : String(value));
let notes: string[] = [];
// What a function below makes is used twice, because plain Bun's transpiler puts a constant that is used once in the place of its use,
// and `return make()` is a tail call, which drops the frame of its caller.
let lastMade: any;
function note(who: string, target: unknown): void {
  notes.push(who + " target=" + nameOf(target) + " [" + frames(new Error(who)) + "]");
}
const describe = (instance: any): string =>
  nameOf(Object.getPrototypeOf(instance)?.constructor) +
  " " +
  show(Object.keys(instance)) +
  (instance instanceof Base ? " is a Base" : "");

function report(label: string, construct: () => any): void {
  notes = [];
  let outcome: string;
  try {
    const instance = construct();
    outcome = describe(instance) + " label=" + show(instance.label);
  } catch (error: any) {
    outcome = "throws " + error.constructor.name + " [" + frames(error) + "]";
  }
  lines.push([label + ": " + outcome, ...notes].join(" ; "));
}

function errorName(action: () => unknown): string {
  try {
    action();
    return "no error";
  } catch (error) {
    return (error as Error).name;
  }
}

class Base {
  label: string;
  constructor(label: string) {
    this.label = label;
    note("Base", new.target);
  }
}
class Derived extends Base {
  extra = 1;
  constructor(label: string) {
    super(label + "+");
    note("Derived", new.target);
  }
}
class Other {}
function Legacy(this: any, label: string) {
  this.label = label;
  note("Legacy", new.target);
}
class Small {
  constructor(public n: number) {
    if (n < 0) note("Small", new.target);
  }
}
class Replaced {
  constructor(result: unknown) {
    note("Replaced", new.target);
    return result as any;
  }
}
class Thrower {
  constructor() {
    note("Thrower", new.target);
    throw new RangeError("from the constructor");
  }
}

const TextBase = new Function(
  "note",
  "return class TextBase { constructor(label) { this.label = label; note('TextBase', new.target); } };",
)(note);
class OverText extends (TextBase as any) {
  more = 2;
  constructor(label: string) {
    super(label);
    note("OverText", new.target);
  }
}
const subclassInText = new Function(
  "C",
  "return class TextDerived extends C { constructor(label) { super(label + '~'); this.text = true; } };",
);

class List extends Array<any> {
  constructor(...list: any[]) {
    super(...list);
    note("List", new.target);
  }
}
class Bytes extends Uint8Array {
  constructor(...list: any[]) {
    super(...(list as [any, any?, any?]));
    note("Bytes", new.target);
  }
}
class Chain extends Promise<any> {
  constructor(...list: any[]) {
    super(...(list as [any]));
    note("Chain", new.target);
  }
}
class Pattern extends RegExp {
  constructor(...list: any[]) {
    super(...(list as [any, any?]));
    note("Pattern", new.target);
  }
}

function plainNew(C: any): any {
  const instance = new C("plain");
  lastMade = instance;
  return instance;
}
function reflectConstruct(C: any): any {
  const instance = Reflect.construct(C, ["reflect"]);
  lastMade = instance;
  return instance;
}
function reflectWithTarget(C: any, T: any): any {
  const instance = Reflect.construct(C, ["target"], T);
  lastMade = instance;
  return instance;
}
function boundNew(C: any): any {
  const instance = new (C.bind(null, "bound"))();
  lastMade = instance;
  return instance;
}
function boundTwice(C: any): any {
  const instance = new (C.bind(null).bind(null, "twice"))();
  lastMade = instance;
  return instance;
}
function reflectBound(C: any): any {
  const instance = Reflect.construct(C.bind(null), ["reflect bound"]);
  lastMade = instance;
  return instance;
}
function proxyNew(C: any): any {
  const instance = new (new Proxy(C, {}))("proxy");
  lastMade = instance;
  return instance;
}
function proxyTrap(C: any): any {
  const trapped = new Proxy(C, {
    construct(target: any, list: any[], newTarget: any) {
      const instance: any = Reflect.construct(target, list, newTarget);
      lastMade = instance;
      return instance;
    },
  });
  const instance = new trapped("trap");
  lastMade = instance;
  return instance;
}
const constructInText = new Function("C", "label", "const instance = new C(label);\nreturn instance;");
function textNew(C: any): any {
  const instance = constructInText(C, "text");
  lastMade = instance;
  return instance;
}
function textSubclassNew(C: any): any {
  const instance = new (subclassInText(C))("sub");
  lastMade = instance;
  return instance;
}

type Way = (C: any, ...targets: any[]) => any;
const ways: [Way, ...any[]][] = [
  [plainNew],
  [reflectConstruct],
  [reflectWithTarget, Other],
  [reflectWithTarget, Derived],
  [reflectWithTarget, subclassInText(Base)],
  [reflectWithTarget, Other.bind(null)],
  [boundNew],
  [boundTwice],
  [reflectBound],
  [proxyNew],
  [proxyTrap],
  [textNew],
  [textSubclassNew],
];

function viaBuiltin(action: () => any): any {
  const result = action();
  lastMade = result;
  return result;
}
const builtinCases: [string, () => any][] = [
  ["List map", () => new List(1, 2, 3).map(item => item)],
  ["List filter", () => new List(1, 2, 3).filter(() => true)],
  ["List slice", () => new List(1, 2, 3).slice(1)],
  ["List.from", () => List.from([1, 2])],
  ["List.of", () => List.of(7)],
  ["Array.from.call", () => (Array.from as any).call(List, [1])],
  ["Bytes map", () => new Bytes([1, 2, 3]).map(item => item)],
  ["Bytes filter", () => new Bytes([1, 2, 3]).filter(() => true)],
  ["Bytes slice", () => new Bytes([1, 2, 3]).slice(1)],
  ["Bytes subarray", () => new Bytes([1, 2, 3]).subarray(1)],
  ["split", () => "a,b".split(new Pattern(","))],
  ["Chain.resolve", () => Chain.resolve(1)],
  ["Chain then", () => new Chain((resolve: any) => resolve(1)).then(value => value)],
  ["Chain.all", () => Chain.all([1])],
];

function replacedWays(value: unknown): any[] {
  const plain = new Replaced(value);
  const reflected = Reflect.construct(Replaced, [value]);
  const fromText = constructInText(Replaced, value);
  const bound = new (Replaced.bind(null, value))();
  return [plain, reflected, fromText, bound];
}

function manySmall() {
  let last;
  for (let i = 2; i >= -1; i--) last = new Small(i);
  return last;
}

function reflectApply(F: any, receiver: object, label: string): object {
  Reflect.apply(F, receiver, [label]);
  return receiver;
}
const callInText = new Function("F", "o", "F.call(o, 'text call'); return o;");
function textCall(F: any): any {
  const receiver = callInText(F, {});
  lastMade = receiver;
  return receiver;
}
const callWithoutNew = new Function("C", "return C('x');");

const constructWithoutArguments = new Function("f", "return new f();");
const notConstructors: [string, any][] = [
  ["an arrow function", () => {}],
  ["a method", { m() {} }.m],
  ["an async function", async function () {}],
  ["a generator function", function* () {}],
];

async function main(): Promise<void> {
  for (const C of [Base, Derived, Legacy, OverText, TextBase, Thrower] as any[]) {
    for (const [way, ...targets] of ways) {
      report(nameOf(way) + "(" + [C, ...targets].map(nameOf).join(", ") + ")", () => way(C, ...targets));
    }
  }

  const pending: Promise<any>[] = [];
  for (const [label, action] of builtinCases) {
    notes = [];
    const result = viaBuiltin(action);
    if (result instanceof Promise) pending.push(result);
    lines.push(["viaBuiltin(" + label + "): " + nameOf(result.constructor) + " " + show(result), ...notes].join(" ; "));
  }

  for (const value of [{ other: 1 }, 7, undefined, null]) {
    notes = [];
    const results = replacedWays(value).map(instance => (instance === value ? "the value" : describe(instance)));
    lines.push(["replacedWays(" + show(value) + "): " + results.join(", "), ...notes].join(" ; "));
  }

  notes = [];
  const smallest = [manySmall(), manySmall(), manySmall()].map(small => small?.n);
  const distinct = new Set(notes).size;
  lines.push("manySmall: " + show(smallest) + " " + notes.length + " notes, " + distinct + " distinct: " + notes[0]);

  report("reflectApply(Legacy)", () => reflectApply(Legacy, {}, "applied"));
  report("textCall(Legacy)", () => textCall(Legacy));
  lines.push("reflectApply(Base): " + errorName(() => reflectApply(Base, {}, "x")));
  lines.push("callWithoutNew(Base): " + errorName(() => callWithoutNew(Base)));

  for (const [label, f] of notConstructors) {
    lines.push("Reflect.construct of " + label + ": " + errorName(() => Reflect.construct(f, [])));
    lines.push("new in text of " + label + ": " + errorName(() => constructWithoutArguments(f)));
  }
  const arrow = notConstructors[0][1];
  lines.push("new.target is an arrow function: " + errorName(() => Reflect.construct(Base, ["x"], arrow)));

  notes = [];
  const settled: any[] = [];
  for (const promise of pending) settled.push(await promise);
  lines.push(["awaited: " + show(settled), ...notes].join(" ; "));
  console.log(lines.join("\n"));
}
main();
export {};
