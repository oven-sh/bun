// Property reads on functions: the inherited `call`, `apply`, `bind`, `toString` and `Symbol.hasInstance`; the own `name` and
// `length`; static members of a class passed as a parameter; a member read with a key that is a union of string literals. --aot
// resolves these without a lookup for a closure that hasn't changed since it was created, and for a function or class it knows.
// A function is still an object: it can get its own members or a different prototype, and `name` and `length` can be redefined
// or deleted. The output must match plain Bun's either way.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment } from "./harness/flags";
import { printIR, test as testOfIR, writesProgramInto } from "./harness/printed-ir";
import { built, slot, spawned, told, wanted, withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

type Program = {
  file: string;
  text: string;
  /** The program evaluates strings as code, which the interpreter runs. */
  evaluatesStrings?: true;
};

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

// --aot has its own wording for some TypeErrors, so only an error's name is printed.
const typedHelpers = `const opaque = (value: any): any => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
`;
const typeScript = (text: string): Program => ({ file: "main.ts", text: typedHelpers + text + "export {};\n" });

const untypedHelpers = `const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label, action) {
  let outcome;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = error.name;
  }
  console.log(label + ": " + outcome);
}
`;
const javaScript = (text: string, evaluatesStrings?: true): Program => ({
  file: "main.mjs",
  text: untypedHelpers + text,
  evaluatesStrings,
});

const inheritedMembers = `type Callback = (value: number) => unknown;
function viaCall(callback: Callback, value: number): unknown { return callback.call(undefined, value); }
function viaApply(callback: Callback, value: number): unknown { return callback.apply(undefined, [value]); }
function viaBind(callback: Callback, value: number): unknown { return callback.bind(undefined, value)(); }
function typeOfToString(callback: Callback): unknown { return typeof callback.toString(); }
function makes(callback: Callback, value: unknown): unknown { return value instanceof callback; }
`;

// `changed` is first a closure that captures a variable, then one that captures nothing.
const changesToAFunction: Record<string, string> = {
  "nothing": ``,
  "its own call, apply, bind and toString": `changed.call = function () { return "own call"; }; changed.apply = function () { return "own apply"; }; changed.bind = function () { return () => "own bind"; }; changed.toString = function () { return 5; };`,
  "its own call and bind, set through an opaque reference": `opaque(changed).call = function () { return "own call"; }; opaque(changed).bind = function () { return () => "own bind"; };`,
  "its own call, deleted again": `changed.call = function () { return "own call"; }; delete changed.call;`,
  "its own call that isn't a function": `changed.call = "a string";`,
  "a getter for call": `Object.defineProperty(changed, "call", { get() { return () => "call from a getter"; } });`,
  "a null prototype": `Object.setPrototypeOf(changed, null);`,
  "a different prototype": `Object.setPrototypeOf(changed, { call() { return "inherited call"; }, apply() { return "inherited apply"; }, bind() { return () => "inherited bind"; }, toString() { return 5; } });`,
  "a prototype that inherits from Function.prototype": `Object.setPrototypeOf(changed, Object.create(Function.prototype, { call: { value() { return "call from the new prototype"; } } }));`,
  "an unrelated property": `changed.extra = 1;`,
  "frozen": `Object.freeze(changed);`,
  "non-extensible": `Object.preventExtensions(changed);`,
  "its own Symbol.hasInstance": `Object.defineProperty(changed, Symbol.hasInstance, { value: () => true });`,
  "a different prototype property": `changed.prototype = Object.prototype;`,
  "reads of its name, length and prototype": `void changed.name; void changed.length; void changed.prototype;`,
};

const programAboutAChangedFunction = (change: string) =>
  typeScript(`${inheritedMembers}function describe(label: string, callback: Callback): void {
  attempt(label + ", call", () => viaCall(callback, 2));
  attempt(label + ", apply", () => viaApply(callback, 3));
  attempt(label + ", bind", () => viaBind(callback, 4));
  attempt(label + ", toString", () => typeOfToString(callback));
  attempt(label + ", instanceof", () => makes(callback, {}));
  attempt(label + ", called", () => callback(5));
}
let offset = 0;
const capturing: Callback = function (value) { return value * 2 + offset; };
const capturingNothing: Callback = function (value) { return value * 3; };
const unchanged: Callback = function (value) { return value + 100 + offset; };
function showAll(when: string): void {
  describe(when + ", the closure that captures", capturing);
  describe(when + ", the closure that captures nothing", capturingNothing);
  describe(when + ", the unchanged closure", unchanged);
}
showAll("before");
showAll("before, again");
offset = 1;
for (const changed of [capturing, capturingNothing] as any[]) {
  ${change}
}
showAll("after");
showAll("after, again");
`);

const programs: Record<string, Program> = {
  "every kind of callable where a function is expected":
    typeScript(`${inheritedMembers}async function describe(label: string, callback: Callback): Promise<void> {
  const steps: [string, () => unknown][] = [
    ["call", () => viaCall(callback, 2)],
    ["apply", () => viaApply(callback, 3)],
    ["bind", () => viaBind(callback, 4)],
    ["toString", () => typeOfToString(callback)],
    ["instanceof", () => makes(callback, {})],
  ];
  for (const [step, action] of steps) {
    let outcome: string;
    try {
      outcome = show(await action());
    } catch (error) {
      outcome = (error as Error).name;
    }
    console.log(label + ", " + step + ": " + outcome);
  }
}
const double = function (value: number) { return value * 2; };
const kinds: [string, any][] = [
  ["a function", double],
  ["an arrow function", (value: number) => value * 2],
  ["an async function", async function (value: number) { return value * 2; }],
  ["an async arrow function", async (value: number) => value * 2],
  ["a generator function", function* (value: number) { yield value * 2; }],
  ["an async generator function", async function* (value: number) { yield value * 2; }],
  ["a class", class Made { value: number; constructor(value: number) { this.value = value; } }],
  ["a method", { method(value: number) { return value * 2; } }.method],
  ["a getter's function", Object.getOwnPropertyDescriptor({ get got() { return 1; } }, "got")!.get],
  ["a bound function", double.bind(null)],
  ["a bound function with an argument", double.bind(null, 7)],
  ["a built-in function", Math.abs],
  ["a host function", btoa],
  ["a proxy for a function", new Proxy(double, {})],
  ["a proxy that traps call", new Proxy(double, { get(target, key, receiver) { return key === "call" ? () => "trapped call" : Reflect.get(target, key, receiver); } })],
  ["an object with call, apply, bind and toString", { call() { return "call of an object"; }, apply() { return "apply of an object"; }, bind() { return () => "bind of an object"; }, toString() { return "a string"; } }],
  ["an empty object", {}],
  ["undefined", undefined],
];
for (const [label, callback] of kinds) {
  await describe("a function", double);
  await describe(label, callback);
}
`),

  "a static member read through a parameter": typeScript(`class A {
  static x = 1;
}
class B extends A {}
function read(kind: typeof A): unknown { return kind.x; }
function store(kind: typeof A, value: number): void { kind.x = value; }
function showAll(when: string): void {
  attempt(when + ", A", () => read(A));
  attempt(when + ", B", () => read(B));
}
showAll("as declared");
showAll("as declared, again");
A.x = 2;
showAll("assigned");
store(A, 3);
showAll("assigned through the parameter");
store(B, 4);
showAll("assigned on the subclass");
(A as any).x = "a string";
showAll("a string");
delete (B as any).x;
showAll("deleted on the subclass");
delete (A as any).x;
showAll("deleted");
Object.defineProperty(A, "x", { get() { return "computed"; }, configurable: true });
showAll("a getter");
`),

  "static members of several classes read through a parameter": typeScript(`class Shape {
  static sides = 0;
  static label = "shape";
  static describe(): string { return this.label + " with " + this.sides; }
}
class Square extends Shape {
  static override sides = 4;
  static override label = "square";
}
class Plain extends Shape {}
function sidesOf(kind: typeof Shape): unknown { return kind.sides; }
function labelOf(kind: typeof Shape): unknown { return kind.label; }
function describe(kind: typeof Shape): unknown { return kind.describe(); }
function setSides(kind: typeof Shape, sides: number): void { kind.sides = sides; }
function nameOf(kind: typeof Shape): unknown { return kind.name; }
function make(kind: typeof Shape): unknown { return new kind() instanceof Shape; }
const kinds: [string, typeof Shape][] = [
  ["Shape", Shape],
  ["Square", Square],
  ["Plain", Plain],
];
function showAll(when: string): void {
  for (const [name, kind] of kinds) attempt(when + ", " + name, () => [sidesOf(kind), labelOf(kind), describe(kind), nameOf(kind), make(kind)].join(" | "));
}
showAll("as declared");
showAll("as declared, again");
setSides(Shape, 1);
showAll("Shape.sides assigned");
setSides(Plain, 2);
showAll("Plain.sides assigned");
(Square as any).sides = "four";
showAll("Square.sides is a string");
delete (Square as any).label;
showAll("Square.label deleted");
Object.defineProperty(Shape, "label", { get() { return "computed"; }, configurable: true });
showAll("Shape.label is a getter");
(Shape as any).describe = function () { return "replaced"; };
showAll("Shape.describe replaced");
Object.setPrototypeOf(Plain, Square);
showAll("Plain inherits from Square");
Object.defineProperty(Square, "name", { value: "Renamed" });
showAll("Square renamed");
kinds.push(["an object", { sides: 9, label: "object", describe() { return "from an object"; }, name: "not a class" } as any]);
kinds.push(["a function", Object.assign(function () {}, { sides: 8, label: "function", describe() { return "from a function"; } }) as any]);
kinds.push(["null", null as any]);
showAll("values that aren't classes");
`),

  "members of constructor functions read through a parameter": javaScript(`function Old() {}
Old.version = 1;
Old.create = function () { return new Old(); };
Old.prototype.greet = function () { return "old"; };
function Newer() {}
Newer.version = 2;
Newer.create = function () { return new Newer(); };
Newer.prototype.greet = function () { return "newer"; };
function versionOf(constructor) { return constructor.version; }
function created(constructor) { return constructor.create().greet() + " " + (constructor.create() instanceof constructor); }
function prototypeOf(constructor) { return constructor.prototype === Object.getPrototypeOf(new constructor()); }
function showAll(when) {
  for (const constructor of [Old, Newer]) attempt(when + ", " + constructor.name, () => [versionOf(constructor), created(constructor), prototypeOf(constructor)].join(" | "));
}
showAll("as created");
showAll("as created, again");
Old.version = "one";
showAll("the version is a string");
delete Old.version;
showAll("the version deleted");
Object.defineProperty(Newer, "version", { get() { return "computed"; }, configurable: true });
showAll("the version is a getter");
Old.create = Newer.create;
showAll("create replaced");
Old.prototype = { greet() { return "a different prototype"; } };
Old.create = function () { return new Old(); };
showAll("a different prototype property");
`),

  "a class or function member read with a union-typed key": typeScript(`class Kinds {
  static alpha = 1;
  static beta = "two";
  static gamma() { return 3; }
}
type Key = "alpha" | "beta" | "gamma";
function pick(key: Key): unknown { return Kinds[key]; }
function pickFrom(holder: typeof Kinds, key: Key): unknown { return holder[key]; }
function put(key: "alpha", value: number): void { Kinds[key] = value; }
function has(key: Key): boolean { return key in Kinds; }
function tools() { return "called"; }
tools.first = 1;
tools.second = "two";
function pickTool(key: "first" | "second"): unknown { return tools[key]; }
const keys: unknown[] = ["alpha", "beta", "gamma", "first", "second", "name", "length", "prototype", "missing", "", 0, Symbol.hasInstance, { toString() { return "alpha"; } }, undefined];
function showAll(when: string): void {
  keys.forEach((key, position) => {
    const label = when + ", " + position + " " + show(key);
    attempt(label + ", on the class", () => pick(key as Key));
    attempt(label + ", on the class passed as a parameter", () => pickFrom(Kinds, key as Key));
    attempt(label + ", in the class", () => has(key as Key));
    attempt(label + ", on the function", () => pickTool(key as "first"));
  });
}
showAll("as declared");
put("alpha", 10);
tools.first = 11;
showAll("assigned");
delete (Kinds as any).beta;
delete (tools as any).second;
showAll("deleted");
Object.defineProperty(Kinds, "gamma", { get() { return "computed"; }, configurable: true });
Object.defineProperty(tools, "first", { get() { return "computed"; }, configurable: true });
showAll("getters");
(Kinds as any).missing = "added";
(tools as any).missing = "added";
showAll("added");
`),

  "name and length of every kind of function": javaScript(`function declared(a, b, c = 1, ...rest) {}
const arrow = a => a;
const assigned = function () {};
const named = function inner() {};
const anonymous = (() => function () {})();
const defaulted = (a = 1, b) => {};
const gathered = (...all) => {};
const destructured = ({ a }, [b], c) => {};
class Klass {
  constructor(a, b) {}
  static method(a) {}
  method() {}
  get value() { return 1; }
  set value(v) {}
  static #hidden() {}
  static hidden() { return Klass.#hidden; }
}
class Heir extends Klass {}
class WithName { static name = "custom"; }
class WithNameMethod { static name() {} }
class WithLength { static length = 9; }
const NamelessClass = (() => class {})();
const tag = Symbol("tag");
const object = {
  method() {},
  ["computed" + 1]() {},
  [tag]() {},
  [Symbol()]() {},
  get got() { return 1; },
  set got(v) {},
  arrow: () => {},
  plain: function () {},
  async later() {},
  *made() {},
  5() {},
};
async function later() {}
function* made() {}
async function* both() {}
const bound = declared.bind(null, 1);
const boundTwice = bound.bind(null);
const boundWithExtraArguments = arrow.bind(null, 1, 2, 3);
let late;
late = function () {};
const { pattern = function () {} } = {};
const elements = [function () {}];
const element = elements[0];
let filled;
filled ||= function () {};
const renamed = Object.defineProperty(function original() {}, "name", { value: "renamed" });
const functions = {
  declared, arrow, assigned, named, anonymous, defaulted, gathered, destructured,
  Klass, Heir, WithName, WithNameMethod, WithLength, NamelessClass,
  "Klass.method": Klass.method,
  "Klass.prototype.method": Klass.prototype.method,
  "Klass's getter": Object.getOwnPropertyDescriptor(Klass.prototype, "value").get,
  "Klass's setter": Object.getOwnPropertyDescriptor(Klass.prototype, "value").set,
  "a private method": Klass.hidden(),
  "object.method": object.method,
  "object.computed1": object.computed1,
  "object[tag]": object[tag],
  "object[Symbol()]": object[Object.getOwnPropertySymbols(object)[1]],
  "object's getter": Object.getOwnPropertyDescriptor(object, "got").get,
  "object's setter": Object.getOwnPropertyDescriptor(object, "got").set,
  "object.arrow": object.arrow,
  "object.plain": object.plain,
  "object.later": object.later,
  "object.made": object.made,
  "object[5]": object[5],
  later, made, both, bound, boundTwice, boundWithExtraArguments, late, pattern, element, filled, renamed,
  "bound renamed": renamed.bind(null),
  "bound class": Klass.bind(null, 1),
  "Math.max": Math.max,
  "bound Math.max": Math.max.bind(null),
};
function nameOf(callable) { return callable.name; }
function lengthOf(callable) { return callable.length; }
for (const [label, callable] of Object.entries(functions)) {
  attempt(label + ", name", () => nameOf(callable));
  attempt(label + ", length", () => lengthOf(callable));
  attempt(label + ", own names", () => Object.getOwnPropertyNames(callable).join());
  attempt(label + ", descriptors", () => JSON.stringify([Object.getOwnPropertyDescriptor(callable, "name"), Object.getOwnPropertyDescriptor(callable, "length")]));
}
function namesOfKnownFunctions() {
  return [declared.name, arrow.name, assigned.name, named.name, anonymous.name, Klass.name, Heir.name, WithName.name, typeof WithNameMethod.name, WithLength.name, NamelessClass.name, later.name, made.name, both.name, bound.name, boundTwice.name, late.name, renamed.name, Klass.method.name, object.method.name].join();
}
function lengthsOfKnownFunctions() {
  return [declared.length, arrow.length, defaulted.length, gathered.length, destructured.length, Klass.length, Heir.length, WithName.length, WithLength.length, later.length, bound.length, boundTwice.length, boundWithExtraArguments.length, Klass.method.length].join();
}
attempt("names of known functions", namesOfKnownFunctions);
attempt("names of known functions, again", namesOfKnownFunctions);
attempt("lengths of known functions", lengthsOfKnownFunctions);
attempt("lengths of known functions, again", lengthsOfKnownFunctions);
`),
};

// Two functions read `name` and `length` of `target`, a function declaration.
const changesToNameAndLength: Record<string, { text: string; evaluatesStrings?: true }> = {
  "nothing": { text: `` },
  "Object.defineProperty": {
    text: `Object.defineProperty(target, "name", { value: "renamed" }); Object.defineProperty(target, "length", { value: 7 });`,
  },
  "Object.defineProperty with computed names": {
    text: `for (const key of [decoded("name"), decoded("length")]) Object.defineProperty(target, key, { value: key + " replaced" });`,
  },
  "Object.defineProperty through an opaque reference": {
    text: `Object.defineProperty(opaque(target), "name", { value: "renamed" }); Object.defineProperty(opaque(target), "length", { value: 7 });`,
  },
  "Object.defineProperties": {
    text: `Object.defineProperties(target, { name: { value: "renamed" }, length: { value: 7 } });`,
  },
  "Reflect.defineProperty": {
    text: `Reflect.defineProperty(target, "name", { value: "renamed" }); Reflect.defineProperty(target, "length", { value: 7 });`,
  },
  "getters": {
    text: `Object.defineProperty(target, "name", { get() { return "computed"; } }); Object.defineProperty(target, "length", { get() { return "computed"; } });`,
  },
  "delete": { text: `delete target.name; delete target.length;` },
  "delete, then a different prototype": {
    text: `delete target.name; delete target.length; Object.setPrototypeOf(target, { name: "inherited", length: "inherited" });`,
  },
  "a failed assignment": { text: `Reflect.set(target, "name", "assigned"); Reflect.set(target, "length", 7);` },
  "made writable, then assigned": {
    text: `Object.defineProperty(target, "name", { writable: true }); Object.defineProperty(target, "length", { writable: true }); target.name = "assigned"; target.length = 7;`,
  },
  "new Function": {
    text: `new Function("f", decoded("Object.defineProperty(f, 'name', { value: 'renamed by new Function' }); delete f.length;"))(target);`,
    evaluatesStrings: true,
  },
};

const programAboutNameAndLength = ({ text, evaluatesStrings }: (typeof changesToNameAndLength)[string]) =>
  javaScript(
    `function target(a, b) { return a + b; }
function nameOfTarget() { return target.name; }
function lengthOfTarget() { return target.length; }
globalThis.kept = [nameOfTarget, lengthOfTarget];
function showAll(when) {
  attempt(when + ", name", nameOfTarget);
  attempt(when + ", length", lengthOfTarget);
  attempt(when + ", has", () => [Object.hasOwn(target, "name"), Object.hasOwn(target, "length"), target(1, 2)].join());
}
showAll("before");
showAll("before, again");
${text}
showAll("after");
showAll("after, again");
`,
    evaluatesStrings,
  );

const ways: Record<string, string[]> = {
  "by default": [],
  "in a validating build": [buildFlags.validate],
  "without flow results": [buildFlags.withoutFlowResults],
  "with types erased": [buildFlags.eraseTypes],
};
// A debug or ASAN build of Bun is many times slower. A JavaScript program has no types to erase.
const waysOf = ({ file }: Program) =>
  Object.keys(ways).filter(way =>
    wanted === "quick" ? way === "by default" : file.endsWith(".ts") || way !== "with types erased",
  );

async function compile(folder: string, { file }: Program, flags: string[]) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), ...compileCommand, ...flags, file, "--outfile", executable], folder, bunEnv));
  return { executable };
}

async function expectOutputOfPlainBun(program: Program, flags: string[]) {
  using dir = tempDir("aot-function-members", { "tsconfig.json": tsconfig, [program.file]: program.text });
  const folder = String(dir);
  const plain = await spawned([bunExe(), "run", program.file], folder, bunEnv);
  expect({
    signal: plain.signal,
    exitCode: plain.exitCode,
    stderr: plain.stderr,
    printsNothing: plain.stdout === "",
  }).toEqual({ signal: null, exitCode: 0, stderr: "", printsNothing: false });
  const { executable } = await compile(folder, program, flags);
  const tripwire = program.evaluatesStrings ? {} : { [runtimeEnvironment.forbidsInterpreter]: "1" };
  const compiled = await spawned(withoutCoreDump([executable]), folder, { ...bunEnv, ...tripwire });
  expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
}

function define(title: string, named: [string, Program][]) {
  describe.concurrent(title, () => {
    for (const [name, program] of named) {
      for (const way of waysOf(program))
        test(`${name}, ${way}`, () => slot(() => expectOutputOfPlainBun(program, ways[way])), 600_000);
    }
  });
}

define("compile/aot/function members", Object.entries(programs));
define(
  "compile/aot/function members/closure changes",
  Object.entries(changesToAFunction).map(([name, change]) => [name, programAboutAChangedFunction(change)]),
);
define(
  "compile/aot/function members/name and length changes",
  Object.entries(changesToNameAndLength).map(([name, change]) => [name, programAboutNameAndLength(change)]),
);

// One function's IR after instruction selection. A read that is still by name has the name as its key.
async function selectedCodeOf(functionName: string, program: Program) {
  using dir = tempDir("aot-function-members-code", { [program.file]: program.text });
  await compile(String(dir), program, [writesProgramInto(String(dir))]);
  const code = await printIR(String(dir), { until: "Select", functionName });
  expect(code).toContain(`name="${functionName}"`);
  return code;
}

describe.concurrent("compile/aot/function members/name and length of a known function", () => {
  testOfIR(
    "are constants if nothing changes them",
    () =>
      slot(async () => {
        const program = programAboutNameAndLength(changesToNameAndLength["nothing"]);
        expect(await selectedCodeOf("nameOfTarget", program)).not.toContain(`key="name"`);
        expect(await selectedCodeOf("lengthOfTarget", program)).not.toContain(`key="length"`);
      }),
    600_000,
  );

  testOfIR(
    "are read by name if the program redefines them",
    () =>
      slot(async () => {
        const program = programAboutNameAndLength(changesToNameAndLength["Object.defineProperty"]);
        expect(await selectedCodeOf("nameOfTarget", program)).toContain(`key="name"`);
        expect(await selectedCodeOf("lengthOfTarget", program)).toContain(`key="length"`);
      }),
    600_000,
  );
});
