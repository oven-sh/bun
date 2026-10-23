// The Error constructor defines `message` and then `cause` on the new object, each only if it was passed. --aot reads both from
// their slots while an error still has the shape it was created with, and by name otherwise: no message, a cause but no message,
// a message that was deleted, set later or turned into a getter, a subclass with a `message` field, an object that only looks like
// an error.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment } from "./harness/flags";
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
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

const cases: Record<string, { make: string; evaluatesStrings?: true }> = {
  "a message": { make: `new Error("boom")` },
  "no message": { make: `new Error()` },
  "an undefined message": { make: `new Error(undefined)` },
  "an empty message": { make: `new Error("")` },
  "a number message": { make: `new Error(5 as any)` },
  "an object message": { make: `new Error({ toString() { return "converted"; } } as any)` },
  "a message and a cause": { make: `new Error("boom", { cause: "why" })` },
  "a cause but no message": { make: `new Error(undefined, { cause: "why" })` },
  "an undefined cause": { make: `new Error("boom", { cause: undefined })` },
  "options without a cause": { make: `new Error("boom", {})` },
  "an inherited cause option": { make: `new Error("boom", Object.create({ cause: "inherited" }))` },
  "called without new": { make: `Error("called")` },
  "a deleted message": {
    make: `(() => { const error = new Error("boom"); delete (error as any).message; return error; })()`,
  },
  "a message deleted and set again": {
    make: `(() => { const error = new Error("boom", { cause: "why" }); delete (error as any).message; error.message = "again"; return error; })()`,
  },
  "a reassigned message": {
    make: `(() => { const error = new Error("boom"); error.message = "reassigned"; return error; })()`,
  },
  "a message set later": {
    make: `(() => { const error = new Error(); error.message = "set later"; return error; })()`,
  },
  "a cause set later": {
    make: `(() => { const error = new Error("boom"); error.cause = "set later"; return error; })()`,
  },
  "a cause set before the message": {
    make: `(() => { const error = new Error(); error.cause = "first"; error.message = "second"; return error; })()`,
  },
  "another property set before the message": {
    make: `(() => { const error = new Error(); (error as any).code = "E_FIRST"; error.message = "second"; return error; })()`,
  },
  "a getter for the message": {
    make: `Object.defineProperty(new Error("boom"), "message", { get() { return "computed"; }, configurable: true })`,
  },
  "a getter for a missing message": {
    make: `Object.defineProperty(new Error(), "message", { get() { return "computed"; }, configurable: true })`,
  },
  "a read-only message": { make: `Object.defineProperty(new Error("boom"), "message", { writable: false })` },
  "an enumerable message": { make: `Object.defineProperty(new Error("boom"), "message", { enumerable: true })` },
  "frozen": { make: `Object.freeze(new Error("boom", { cause: "why" }))` },
  "a subclass": { make: `new (class Failure extends Error {})("boom")` },
  "a subclass, no message": { make: `new (class Failure extends Error {})()` },
  "a subclass with a message field": {
    make: `new (class Failure extends Error { override message = "field"; })("boom")`,
  },
  "a subclass with a message field, no message": {
    make: `new (class Failure extends Error { override message = "field"; })()`,
  },
  "a subclass with another field": { make: `new (class Failure extends Error { code = "E_FIELD"; })("boom")` },
  "a subclass whose constructor sets the message": {
    make: `new (class Failure extends Error { constructor() { super(); this.message = "set by the constructor"; } })()`,
  },
  "a subclass that forwards a cause": {
    make: `new (class Failure extends Error { constructor(message: string, cause: unknown) { super(message, { cause }); } })("boom", "why")`,
  },
  "a subclass with a message getter on its prototype": {
    make: `(() => { class Failure extends Error {} Object.defineProperty(Failure.prototype, "message", { get() { return "from the prototype"; }, configurable: true }); return new Failure(); })()`,
  },
  "a subclass with a message getter on its prototype, and a message": {
    make: `(() => { class Failure extends Error {} Object.defineProperty(Failure.prototype, "message", { get() { return "from the prototype"; }, configurable: true }); return new Failure("boom"); })()`,
  },
  "TypeError": { make: `new TypeError("boom")` },
  "RangeError, no message": { make: `new RangeError()` },
  "AggregateError": { make: `new AggregateError([new Error("inner")], "boom", { cause: "why" })` },
  "DOMException": { make: `new DOMException("boom", "AbortError") as unknown as Error` },
  "a JSON.parse error": {
    make: `(() => { try { JSON.parse("{"); } catch (error) { return error as Error; } return new Error("not reached"); })()`,
  },
  "a file system error": {
    make: `(() => { try { require("node:fs").readFileSync("/no/such/file"); } catch (error) { return error as Error; } return new Error("not reached"); })()`,
  },
  "a structured clone": { make: `structuredClone(new Error("boom", { cause: "why" }))` },
  "a different new.target": { make: `Reflect.construct(Error, ["boom"], class Other {})` },
  "a null prototype": { make: `Object.setPrototypeOf(new Error("boom"), null)` },
  "Object.create(Error.prototype)": { make: `Object.create(Error.prototype)` },
  "an error-like object": { make: `({ name: "Lookalike", message: "from a plain object" })` },
  "a plain object with a captured stack": {
    make: `(() => { const target = { name: "Plain", message: "from a plain object" }; Error.captureStackTrace(target); return target; })()`,
  },
  "a proxy for an error": {
    make: `new Proxy(new Error("boom"), { get(target, key, receiver) { return key === "message" ? "trapped" : Reflect.get(target, key, receiver); } })`,
  },
  "from another realm": {
    make: `require("node:vm").runInNewContext("new Error('boom', { cause: 'why' })")`,
    evaluatesStrings: true,
  },
  "from another realm, no message": {
    make: `require("node:vm").runInNewContext("new Error()")`,
    evaluatesStrings: true,
  },
};

// --aot has its own wording for some TypeErrors, so only an error's name is printed when an action throws.
const programAboutErrors = (names: string[]): Program => ({
  file: "main.ts",
  evaluatesStrings: names.some(name => cases[name].evaluatesStrings) || undefined,
  text: `function show(value: unknown): string {
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
function messageOf(error: Error): unknown { return error.message; }
function causeOf(error: Error): unknown { return error.cause; }
function setMessage(error: Error, message: string): void { error.message = message; }
function setCause(error: Error, cause: unknown): void { error.cause = cause; }
function describe(label: string, error: Error): void {
  attempt(label + ", message", () => messageOf(error));
  attempt(label + ", message again", () => messageOf(error));
  attempt(label + ", cause", () => causeOf(error));
  attempt(label + ", has", () => [Object.hasOwn(error, "message"), Object.hasOwn(error, "cause"), "message" in error, "cause" in error].join());
  attempt(label + ", descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(error, "message")));
  attempt(label + ", as a string", () => String(error));
  attempt(label + ", keys", () => Object.keys(error).join());
  attempt(label + ", stack", () => (typeof error.stack === "string" ? error.stack.split("\\n")[0] : typeof error.stack));
}
const cases: [string, () => Error][] = [
${names.map(name => `  [${JSON.stringify(name)}, () => ${cases[name].make}],`).join("\n")}
];
for (const [name, make] of cases) {
  describe(name, make());
  const reassigned = make();
  attempt(name + ", set the message", () => setMessage(reassigned, "set afterwards"));
  describe(name + ", after setting the message", reassigned);
  const removed = make();
  attempt(name + ", delete the message", () => delete (removed as any).message);
  describe(name + ", after deleting the message", removed);
  const caused = make();
  attempt(name + ", set the cause", () => setCause(caused, "set afterwards"));
  describe(name + ", after setting the cause", caused);
}
export {};
`,
});

const alone = [
  "a message",
  "no message",
  "a message and a cause",
  "a cause but no message",
  "a deleted message",
  "a cause set before the message",
  "a getter for the message",
  "a subclass",
  "a subclass with a message field",
  "a subclass with a message getter on its prototype",
  "Object.create(Error.prototype)",
  "an error-like object",
  "from another realm",
  "from another realm, no message",
];

// `holder` is Error.prototype.
const prototypeChanges: Record<string, string> = {
  "toString is replaced": `holder.toString = function () { return "<" + this.name + ">"; };`,
  "toString is deleted": `delete holder.toString;`,
  "toString becomes a getter": `Object.defineProperty(holder, "toString", { get() { return () => "from a getter"; }, configurable: true });`,
  "name is replaced": `holder.name = "Renamed";`,
  "name is deleted": `delete holder.name;`,
  "message is replaced": `holder.message = "inherited message";`,
  "message becomes a getter": `Object.defineProperty(holder, "message", { get() { return "computed for " + this.name; }, configurable: true });`,
  "a property is added": `holder.code = "E_ADDED";`,
  "its prototype is replaced": `delete holder.toString; Object.setPrototypeOf(holder, { toString() { return "from further up"; }, code: "E_FURTHER_UP" });`,
};
const holders: Record<string, string> = {
  "referenced directly": `Error.prototype`,
  "returned by native code": `new CustomEvent("opaque", { detail: Error.prototype }).detail`,
};

const programAboutThePrototype = (change: string, holder: string): Program => ({
  file: "main.mjs",
  text: `const made = new RangeError("far");
const bare = new Error();
function viaToString(error) { return error.toString(); }
function converted(error) { return String(error); }
function nameOf(error) { return error.name; }
function messageOf(error) { return error.message; }
function codeOf(error) { return error.code; }
function show() {
  for (const error of [made, bare, new TypeError("fresh"), new Error()]) {
    console.log([viaToString(error), converted(error), nameOf(error), messageOf(error), codeOf(error)].join(" | "));
  }
}
show();
show();
const holder = ${holder};
${change}
show();
show();
`,
});

const ways: Record<string, string[]> = {
  "by default": [],
  "in a validating build": [buildFlags.validate],
  "without flow results": [buildFlags.withoutFlowResults],
  "with types erased": [buildFlags.eraseTypes],
};
// A debug or ASAN build of Bun is many times slower.
const chosen = (names: string[]) => (wanted === "quick" ? names.slice(0, 1) : names);

async function runBothWays({ file, text, evaluatesStrings }: Program, flags: string[]) {
  using dir = tempDir("aot-error-own-properties", { "tsconfig.json": tsconfig, [file]: text });
  const folder = String(dir);
  const plain = await spawned([bunExe(), "run", file], folder, bunEnv);
  expect({
    signal: plain.signal,
    exitCode: plain.exitCode,
    stderr: plain.stderr,
    printsNothing: plain.stdout === "",
  }).toEqual({ signal: null, exitCode: 0, stderr: "", printsNothing: false });
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), ...compileCommand, ...flags, file, "--outfile", executable], folder, bunEnv));
  const tripwire = evaluatesStrings ? {} : { [runtimeEnvironment.forbidsInterpreter]: "1" };
  const compiled = await spawned(withoutCoreDump([executable]), folder, { ...bunEnv, ...tripwire });
  return { plain, compiled };
}

async function expectOutputOfPlainBun(program: Program, flags: string[]) {
  const { plain, compiled } = await runBothWays(program, flags);
  expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
}

describe.concurrent("compile/aot/error own properties", () => {
  const everything = programAboutErrors(Object.keys(cases).filter(name => !cases[name].evaluatesStrings));
  for (const way of chosen(Object.keys(ways))) {
    test(`every error at one site, ${way}`, () => slot(() => expectOutputOfPlainBun(everything, ways[way])), 600_000);
  }
  // The analysis proves more about a program that has only one kind of error.
  for (const name of alone) {
    for (const way of chosen(Object.keys(ways))) {
      test(
        `${name}, alone, ${way}`,
        () => slot(() => expectOutputOfPlainBun(programAboutErrors([name]), ways[way])),
        600_000,
      );
    }
  }
});

describe.concurrent("compile/aot/error own properties/inherited members", () => {
  for (const [change, text] of Object.entries(prototypeChanges)) {
    for (const [origin, holder] of Object.entries(holders)) {
      for (const way of chosen(["by default", "in a validating build"])) {
        test(
          `${change} on Error.prototype ${origin}, ${way}`,
          () => slot(() => expectOutputOfPlainBun(programAboutThePrototype(text, holder), ways[way])),
          600_000,
        );
      }
    }
  }
});
