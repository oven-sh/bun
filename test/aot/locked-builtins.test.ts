// Under `--aot` the members that the built-in objects of the language have cannot be replaced, and two parts of Bun say so:
//   - `bun build --compile --aot` stops with TS100014 at an assignment that always runs and always fails;
//   - the compiled program throws a TypeError where the write runs, in sloppy code as in strict code, and `Reflect.*` returns false.
// docs/bundler/aot-compatibility.mdx says which objects, which members, and what can be added. Here each write below goes through both, and through plain Bun.
// The lists: rejected by both, rejected at run time alone, the same with and without `--aot`, and short ones that say what they hold.
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { slot, unsupported } from "./run-programs";

// `f` is a function and `d` a property descriptor. Before the first `|`: the object that the write is about. After a second `|`: the extension of
// the file that the build reads the write from, where it is not `js`. Only a CommonJS file can have a `return` outside a function.
const rejected = `
globalThis | Array = f;
globalThis | globalThis.Array = f;
globalThis | delete globalThis.Array;
globalThis | Object.defineProperty(globalThis, "Array", d);
globalThis | Proxy = f;
globalThis | globalThis.Proxy = f;
globalThis | delete globalThis.Proxy;
globalThis | Atomics = f;
globalThis | Uint8Array = f;
globalThis | globalThis.process = f;
globalThis | delete globalThis.process;
Array.prototype | Array.prototype[Symbol.toPrimitive] = f;
Array.prototype | Array.prototype[Symbol.toStringTag] = "T";
Object.prototype | Object.prototype[Symbol.toPrimitive] = f;
Map.prototype | Map.prototype[Symbol.hasInstance] = f;
Function.prototype | Function.prototype.prototype = f;
Object.prototype | Object.prototype.zzz = f;
Object.prototype | Object.defineProperty(Object.prototype, "zzz", d);
Function.prototype | Function.prototype.zzz = f;
Promise.prototype | Promise.prototype.zzz = f;
Array.prototype | Array.prototype.push = f;
Array.prototype | delete Array.prototype.push;
Array.prototype | Object.defineProperty(Array.prototype, "push", d);
Array.prototype | Array.prototype[Symbol.iterator] = f;
Array.prototype | delete Array.prototype[Symbol.iterator];
Array.prototype | Array.prototype.constructor = f;
Array.prototype | Array.prototype.toString = f;
Array.prototype | Array.prototype.hasOwnProperty = f;
Array.prototype | Object.defineProperty(Array.prototype, "hasOwnProperty", d);
Object.prototype | Object.prototype.toString = f;
Object.prototype | delete Object.prototype.hasOwnProperty;
Map.prototype | Object.defineProperty(Map.prototype, "size", d);
Map.prototype | delete Map.prototype.size;
Uint8Array.prototype | Uint8Array.prototype.set = f;
RegExp.prototype | RegExp.prototype.exec = f;
Array | Array.from = f;
Array | Array.isArray = f;
Array | delete Array.from;
Array | Object.defineProperty(Array, "from", d);
Math | Math.max = f;
Math | delete Math.max;
Math | Object.defineProperty(Math, "max", d);
Math | Math.max = Math.min;
Math | Math.max += 1;
Math | globalThis.Math.max = f;
Reflect | Reflect.get = f;
Atomics | Atomics.add = f;
Object | Object.keys = f;
Object | Object.hasOwn = f;
Number | Number.isNaN = f;
Promise | Promise.resolve = f;
Symbol | Symbol.for = f;
Proxy | Proxy.revocable = f;
Date | Date.toString = f;
Date | Object.defineProperty(Date, "toString", d);
Date | Date.call = f;
Date | Date.hasOwnProperty = f;
Array | Array.bind = f;
Array | Array.constructor = f;
Math | Math.toString = f;
Math | Object.defineProperty(Math, "toString", d);
Math | Math.hasOwnProperty = f;
Math | Math.constructor = f;
JSON | JSON.valueOf = f;
Uint8Array | Uint8Array.from = f;
Uint8Array | Uint8Array.of = f;
Uint8Array | Object.defineProperty(Uint8Array, "from", d);
Array.prototype | Array.prototype.__proto__ = {};
Array.prototype | Array.prototype.__proto__ = null;
Array | Array.__proto__ = {};
Array.prototype | Array.prototype.flat &&= f;
Array.prototype | if (Array.prototype.flat) Array.prototype.flat = f;
Array.prototype | { const P = Array.prototype; P.push = f; }
Array.prototype | { const P = Array.prototype; delete P.push; }
Array.prototype | { let h = f; Array.prototype.push = h; }
Array | Object.defineProperty(Array, "name", d);
Array | delete Array.name;
Array | Object.defineProperty(Array, "length", d);
parseInt | parseInt.call = f;
Date.prototype | Date.prototype.getTime = f;
Intl.Collator | Intl.Collator.apply = f;
`;

// The build stops only where it is certain. Here it cannot tell that the write runs, which property it is about, what it stores, or what the lock does to the property.
// A function of Reflect returns false and throws nothing: the build warns.
const rejectedAtRunTime = `
globalThis | Reflect.set(globalThis, "Array", f);
globalThis | Reflect.defineProperty(globalThis, "Array", d);
globalThis | Reflect.deleteProperty(globalThis, "Array");
globalThis | globalThis.globalThis = f;
Array.prototype | Array.prototype[0] = f;
Array.prototype | Reflect.set(Array.prototype, "push", f);
Array.prototype | Reflect.deleteProperty(Array.prototype, "push");
Array.prototype | Object.assign(Array.prototype, { push: f });
Array | Reflect.set(Array, "from", f);
Array | Object.assign(Array, { from: f });
Map | Object.defineProperty(Map, Symbol.hasInstance, d);
Map | Reflect.defineProperty(Map, Symbol.hasInstance, d);
Array.prototype | Object.setPrototypeOf(Array.prototype, {});
Array.prototype | Reflect.setPrototypeOf(Array.prototype, {});
Array.prototype | Object.setPrototypeOf(Array.prototype, Map.prototype);
Array | Object.setPrototypeOf(Array, {});
Math | Object.setPrototypeOf(Math, {});
globalThis | [Array] = [f];
Array.prototype | Array.prototype.length = 3;
Map.prototype | Object.defineProperty(Map.prototype, Symbol.toStringTag, d);
Array | Object.defineProperty(Array, Symbol.species, d);
Function.prototype | Reflect.set(Function.prototype, "arguments", f);
Function.prototype | Reflect.set(Function.prototype, "caller", f);
Iterator.prototype | Reflect.set(Iterator.prototype, "constructor", f);
Iterator.prototype | Reflect.set(Iterator.prototype, Symbol.toStringTag, f);
parseInt | Object.setPrototypeOf(parseInt, {});
Intl.Collator | Object.setPrototypeOf(Intl.Collator, {});
Date.prototype | Object.defineProperty(Date.prototype, Symbol.toPrimitive, d);
Date.prototype | Reflect.set(Date.prototype, "toJSON", f);
`;

const same = `
globalThis | Intl = f;
globalThis | globalThis.Intl = f;
globalThis | WebAssembly = f;
globalThis | globalThis.WebAssembly = f;
globalThis | globalThis.Temporal = f;
globalThis | globalThis.ShadowRealm = f;
globalThis | Iterator = f;
globalThis | globalThis.Iterator = f;
globalThis | globalThis.eval = f;
globalThis | parseInt = f;
globalThis | globalThis.parseInt = f;
globalThis | Promise = f;
globalThis | Object.assign(globalThis, { Date: f });
globalThis | globalThis.Promise = Map;
Array.prototype | Array.prototype.zzz = f;
Array.prototype | Array.prototype["zzz"] = f;
Array.prototype | Array.prototype.prototype = f;
Array.prototype | Array.prototype.BYTES_PER_ELEMENT = 1;
Array.prototype | Object.defineProperty(Array.prototype, "zzz", d);
Array.prototype | Object.defineProperties(Array.prototype, { zzz: d });
Array.prototype | Object.assign(Array.prototype, { zzz: f });
Array.prototype | Reflect.set(Array.prototype, "zzz", f);
Array.prototype | Reflect.defineProperty(Array.prototype, "zzz", d);
String.prototype | String.prototype.zzz = f;
Iterator.prototype | Iterator.prototype.zzz = f;
Uint8Array.prototype | Uint8Array.prototype.zzz = f;
Intl.Collator.prototype | Intl.Collator.prototype.zzz = f;
Intl.DateTimeFormat.prototype | Object.defineProperty(Intl.DateTimeFormat.prototype, "zzz", d);
WebAssembly.Module.prototype | WebAssembly.Module.prototype.zzz = f;
Temporal.PlainDate.prototype | Temporal.PlainDate.prototype.zzz = f;
ShadowRealm.prototype | ShadowRealm.prototype.zzz = f;
Uint8Array.prototype | Uint8Array.prototype.toBase64 = f;
Intl.NumberFormat.prototype | Intl.NumberFormat.prototype.formatToParts = f;
WebAssembly.Memory.prototype | WebAssembly.Memory.prototype.grow = f;
Temporal.Duration.prototype | Temporal.Duration.prototype.add = f;
Math | Math.random = f;
JSON | JSON.parse = f;
Date | Date.now = f;
Intl | Intl.Collator = f;
Intl | delete Intl.Collator;
Intl | Intl.getCanonicalLocales = f;
Intl.Collator | Intl.Collator.supportedLocalesOf = f;
WebAssembly | WebAssembly.compile = f;
WebAssembly | WebAssembly.Module = f;
Temporal | Temporal.Now = f;
Temporal.Now | Temporal.Now.instant = f;
Error | Error.captureStackTrace = f;
Uint8Array | Uint8Array.fromBase64 = f;
Intl | Intl.toString = f;
TypeError | TypeError.captureStackTrace = f;
AggregateError | AggregateError.isError = f;
eval | eval.toString = f;
Array.prototype | if (!Array.prototype.zzz) Array.prototype.zzz = f;
Array.prototype | if (typeof Array.prototype.zzz !== "function") Array.prototype.zzz = f;
Array.prototype | if (!("zzz" in Array.prototype)) Array.prototype.zzz = f;
Array.prototype | Array.prototype.zzz || (Array.prototype.zzz = f);
Array.prototype | Array.prototype.zzz ||= f;
Array.prototype | Array.prototype.zzz ??= f;
Array.prototype | if (!Array.prototype.flat || !Array.prototype.zzz) Array.prototype.zzz = f;
Array.prototype | if (typeof Math === "object") Array.prototype.zzz = f;
Temporal | if (typeof Temporal.Now !== "function") Temporal.Now = f;
Array.prototype | { const P = Array.prototype; P.zzz = f; }
Array.prototype | { const P = Array.prototype; Object.defineProperty(P, "zzz", d); }
Array.prototype | globalThis.Array.prototype.zzz = f;
Array.prototype | Array.prototype.zzz++;
Array.prototype | label: { Array.prototype.zzz = f; }
Array.prototype | Array.prototype.zzz = f; if (f.length) throw f;
Array.prototype | Array.prototype.zzz = f; if (f.length) return; | cjs
Array.prototype | function g() { if (f.length) throw f; return 1; } Array.prototype.zzz = f;
Array.prototype | const g = () => { throw f; }; Array.prototype.zzz = f;
Array.prototype | throw (Array.prototype.zzz = f);
Array.prototype | if (f.length) throw f; Array.prototype.zzz = f;
Array.prototype | if (f.length) return; Array.prototype.zzz = f; | cjs
Array.prototype | shim: { if (f.length) break shim; Array.prototype.zzz = f; }
Array.prototype | for (const x of [f]) { if (x.length) continue; } Array.prototype.zzz = f;
Array.prototype | { if (f.length) throw f; } Array.prototype.zzz = f;
Array.prototype | if (f.length) throw f; { Array.prototype.zzz = f; }
Array.prototype | switch (f.length) { case 1: throw f; } Array.prototype.zzz = f;
Array.prototype | try { Array.prototype.zzz = f; } finally {}
Array.prototype | for (const x of [f]) Array.prototype.zzz = x;
Array.prototype | (() => { Array.prototype.zzz = f; })();
Array.prototype | class A { static x = (Array.prototype.zzz = f); }
Array.prototype | [Array.prototype.zzz] = [f];
Array.prototype | ({ a: Array.prototype.zzz } = { a: f });
Array.prototype | for (Array.prototype.zzz of [f]);
Array.prototype | for (Array.prototype.zzz in { a: 1 });
Array.prototype | Array.prototype[Symbol.for("zzz")] = f;
Array.prototype | { const k = "zzz"; Array.prototype[k] = f; }
Error.prototype | Error.prototype.zzz = f;
Error.prototype | Error.prototype.name = "x";
Error.prototype | Error.prototype.message = "x";
TypeError.prototype | TypeError.prototype.toString = f;
Error.prototype | if (!Error.prototype.message) Error.prototype.message = "x";
Error.prototype | Error.prototype.message ||= "x";
Error.prototype | Error.prototype.name &&= "x";
Error.prototype | if (typeof Error.prototype.name !== "function") Error.prototype.name = "x";
globalThis | globalThis.NaN = 1;
globalThis | globalThis.Infinity = 1;
globalThis | console = f;
globalThis | globalThis.console = f;
globalThis | globalThis.Buffer = f;
globalThis | globalThis.setTimeout = f;
globalThis | globalThis.URL = f;
globalThis | globalThis.fetch = f;
globalThis | globalThis.structuredClone = f;
globalThis | globalThis.zzz = f;
globalThis | Object.defineProperty(globalThis, "zzz", d);
globalThis | delete globalThis.zzz;
globalThis | Object.assign(globalThis, { zzz: f });
globalThis | Object.setPrototypeOf(globalThis, {});
globalThis | Promise = Promise;
globalThis | globalThis.Promise = Promise;
Array.prototype | delete Array.prototype.zzz;
Array.prototype | Reflect.deleteProperty(Array.prototype, "zzz");
Array.prototype | delete Array.prototype.hasOwnProperty;
Array.prototype | Object.defineProperty(Array.prototype, "length", d);
Array.prototype | delete Array.prototype.length;
Uint8Array.prototype | Reflect.set(Uint8Array.prototype, "byteLength", f);
WebAssembly.Global.prototype | WebAssembly.Global.prototype.value = f;
WebAssembly.Global.prototype | Reflect.set(WebAssembly.Global.prototype, "value", f);
Intl.Collator.prototype | Intl.Collator.prototype.compare = f;
Array | Array.zzz = f;
Array | Array.push = f;
Array | Array.map = f;
Array | Object.defineProperty(Array, "push", d);
Array | Object.assign(Array, { zzz: f });
Array | delete Array.push;
Math | Math.zzz = f;
Math | Math.clamp = f;
Math | Math.zzz += 1;
Math | globalThis.Math.zzz = f;
JSON | JSON.zzz = f;
Date | Date.getTime = f;
String | String.trim = f;
Object | Object.zzz = f;
Promise | Promise.then = f;
Intl | Intl.zzz = f;
Intl.Collator | Intl.Collator.zzz = f;
WebAssembly | WebAssembly.zzz = f;
Proxy | Proxy.zzz = f;
Reflect | Reflect.zzz = f;
parseInt | parseInt.zzz = f;
parseInt | Object.defineProperty(parseInt, "name", d);
Error | Error.stackTraceLimit = 5;
Error | Error.prepareStackTrace = f;
Error | delete Error.stackTraceLimit;
TypeError | TypeError.stackTraceLimit = 5;
Array.prototype | Object.setPrototypeOf(Array.prototype, Object.prototype);
Array | Object.setPrototypeOf(Array, Function.prototype);
Object.prototype | Object.setPrototypeOf(Object.prototype, {});
Math | Math.max = Math.max;
Math | Reflect.set(Math, "max", Math.max);
Intl | Intl.Collator = Intl.Collator;
Number | Number.parseFloat = parseFloat;
String.prototype | String.prototype.trimLeft = String.prototype.trimStart;
Array.prototype | Array.prototype[Symbol.iterator] = Array.prototype.values;
Array.prototype | if (!Array.prototype.flat) Array.prototype.flat = f;
Array.prototype | if (!Array.prototype.flat) { Object.defineProperty(Array.prototype, "flat", d); }
Array.prototype | if (typeof Array.prototype.flat !== "function") Array.prototype.flat = f;
Array.prototype | if (typeof Array.prototype.flat === "undefined") Array.prototype.flat = f;
Array.prototype | if (Array.prototype.flat === undefined) Array.prototype.flat = f;
Array.prototype | if (Array.prototype.flat == null) Array.prototype.flat = f;
Array.prototype | if (!("flat" in Array.prototype)) Array.prototype.flat = f;
Array.prototype | if (!Object.hasOwn(Array.prototype, "flat")) Array.prototype.flat = f;
Array.prototype | if (!Array.prototype.hasOwnProperty("flat")) Array.prototype.flat = f;
Array.prototype | if (!Object.prototype.hasOwnProperty.call(Array.prototype, "flat")) Array.prototype.flat = f;
Array.prototype | if (!Reflect.has(Array.prototype, "flat")) Array.prototype.flat = f;
Array.prototype | if (Array.prototype.flat) {} else Array.prototype.flat = f;
Array.prototype | Array.prototype.flat || (Array.prototype.flat = f);
Array.prototype | Array.prototype.flat ?? (Array.prototype.flat = f);
Array.prototype | !Array.prototype.flat && (Array.prototype.flat = f);
Array.prototype | Array.prototype.flat ||= f;
Array.prototype | Array.prototype.flat ??= f;
Array.prototype | Array.prototype.zzz &&= f;
Array.prototype | Array.prototype.hasOwnProperty ||= f;
Array.prototype | Array.prototype.flat = Array.prototype.flat || f;
Array.prototype | Array.prototype.flat = Array.prototype.flat;
Array.prototype | Array.prototype.flat ? 0 : (Array.prototype.flat = f);
Array.prototype | if (!Array.prototype.flat || !Array.prototype.flatMap) Array.prototype.flat = f;
Array.prototype | if (!Array.prototype[Symbol.iterator]) Array.prototype[Symbol.iterator] = f;
Array.prototype | if (typeof Bun === "undefined") Array.prototype.zzz = f;
Array.prototype | if (typeof Math === "function") Array.prototype.zzz = f;
Array.prototype | { const P = Array.prototype; if (!P.flat) P.flat = f; }
Array.prototype | if (Array.prototype.flat) return; Array.prototype.zzz = f; | cjs
Array.prototype | shim: { if (Array.prototype.flat) break shim; Array.prototype.zzz = f; }
Object | if (!Object.hasOwn) Object.hasOwn = f;
Object | if (typeof Object.assign !== "function") Object.defineProperty(Object, "assign", d);
Object | Object.hasOwn ||= f;
Number | Number.isNaN = Number.isNaN || f;
Number | if (!Number.MAX_SAFE_INTEGER) Number.MAX_SAFE_INTEGER = 9007199254740991;
Symbol | if (!Symbol.asyncIterator) Symbol.asyncIterator = Symbol("x");
globalThis | if (typeof Promise === "undefined") globalThis.Promise = f;
globalThis | if (typeof Promise !== "function") Promise = f;
globalThis | if (!globalThis.Proxy) globalThis.Proxy = f;
globalThis | if (typeof Proxy === "undefined") globalThis.Proxy = f;
globalThis | if (typeof Intl === "undefined") globalThis.Intl = f;
globalThis | if (typeof Intl !== "object") globalThis.Intl = f;
globalThis | if (typeof WebAssembly === "undefined") globalThis.WebAssembly = f;
globalThis | if (!globalThis.Iterator) globalThis.Iterator = f;
globalThis | if (typeof zzz === "undefined") globalThis.zzz = f;
globalThis | globalThis.Promise ||= f;
globalThis | globalThis.Promise = globalThis.Promise || f;
Intl | if (!Intl.Collator) Intl.Collator = f;
Intl | if (typeof Intl.Segmenter === "undefined") Intl.Segmenter = f;
Intl.NumberFormat.prototype | if (!Intl.NumberFormat.prototype.formatToParts) Intl.NumberFormat.prototype.formatToParts = f;
Error.prototype | Error.prototype.message ??= "x";
Error.prototype | Error.prototype.message &&= "x";
Error.prototype | Error.prototype.name ||= "x";
Error.prototype | if (typeof Error.prototype.name !== "string") Error.prototype.name = "x";
Temporal | if (typeof Temporal.Now !== "object") Temporal.Now = f;
Array | if (!Array.zzz) Array.zzz = f;
Date.prototype | Date.prototype.toString = f;
Date.prototype | Date.prototype.toLocaleDateString = f;
Date.prototype | Date.prototype.zzz = f;
Date.prototype | Date.prototype.next = f;
WeakRef.prototype | WeakRef.prototype.deref = f;
`;

// These throw without `--aot` too, in strict code. The build says that they always throw.
const failsEverywhere = `
globalThis | globalThis.undefined = 1;
Map.prototype | Map.prototype.size = 1;
Map.prototype | Map.prototype[Symbol.toStringTag] = "x";
Array | delete Array.prototype;
Array | Array[Symbol.species] = f;
Math | delete Math.PI;
Math | Math.PI++;
Uint8Array.prototype | Uint8Array.prototype.buffer = f;
Float64Array.prototype | Float64Array.prototype[Symbol.toStringTag] = f;
Uint8Array.prototype | Uint8Array.prototype.BYTES_PER_ELEMENT = 2;
RegExp.prototype | RegExp.prototype.flags = "g";
Symbol.prototype | Symbol.prototype.description = "x";
Array | Array.prototype = {};
Array | Array.name = "x";
Array | Array.length = 3;
Math | Math.PI = 3;
Number | Number.MAX_SAFE_INTEGER = 1;
Symbol | Symbol.iterator = f;
Uint8Array | Uint8Array.BYTES_PER_ELEMENT = 2;
Date.prototype | Date.prototype[Symbol.toPrimitive] = f;
`;

// Without `--aot` a setter throws, in sloppy code too. Under `--aot` the assignment is refused before the setter is asked, with a TypeError as well.
// The build says that they always throw.
const refusedBeforeSetter = `
Function.prototype | Function.prototype.arguments = f;
Function.prototype | Function.prototype.caller = f;
Iterator.prototype | Iterator.prototype.constructor = f;
Iterator.prototype | Iterator.prototype[Symbol.toStringTag] = f;
`;

// Without `--aot` nothing undoes these, so they come last.
const sameAndNotUndone = `
Math | Object.freeze(Math);
Array | Object.seal(Array);
Object.prototype | Object.freeze(Object.prototype);
`;

const casesOf = (list: string, build: string, run: string, sloppy = run) =>
  list
    .trim()
    .split("\n")
    .map(line => {
      const [target, code, extension = "js"] = line.split(" | ");
      return { target, code, extension, build, run, sloppy };
    });
const cases = [
  ...casesOf(rejected, "rejected", "rejected"),
  ...casesOf(rejectedAtRunTime, "same", "rejected"),
  ...casesOf(same, "same", "same"),
  ...casesOf(failsEverywhere, "rejected", "same"),
  ...casesOf(refusedBeforeSetter, "rejected", "same"),
  ...casesOf(sameAndNotUndone, "same", "same"),
];
const head = `const f = function () {}; const d = { value: f, configurable: true, writable: true };\n`;

// Calls each write through a table, so that the build cannot tell that it runs. Says what it did and what it changed, and puts
// that back. Between a write and its undoing it uses nothing that a write can replace.
const runner = `
const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf, is } = Object;
const { ownKeys } = Reflect;
const text = String, stringify = JSON.stringify, log = console.log.bind(console);
function look(o) {
  const keys = ownKeys(o), found = [];
  for (let i = 0; i < keys.length; i++) found[i] = [keys[i], getOwnPropertyDescriptor(o, keys[i])];
  return { found, parent: getPrototypeOf(o) };
}
function isSame(a, b) { return is(a.value, b.value) && a.get === b.get && a.set === b.set; }
function at(seen, key) { for (let i = 0; i < seen.found.length; i++) if (seen.found[i][0] === key) return seen.found[i][1]; }
function changes(before, after) {
  let said = "";
  for (let i = 0; i < after.found.length; i++) { const was = at(before, after.found[i][0]); if (!was) said += " +" + text(after.found[i][0]); else if (!isSame(was, after.found[i][1])) said += " ~" + text(after.found[i][0]); }
  for (let i = 0; i < before.found.length; i++) if (!at(after, before.found[i][0])) said += " -" + text(before.found[i][0]);
  return before.parent === after.parent ? said : said + " prototype";
}
function restore(o, before) {
  const after = look(o);
  try { if (after.parent !== before.parent) setPrototypeOf(o, before.parent); } catch {}
  for (let i = 0; i < after.found.length; i++) if (!at(before, after.found[i][0])) { try { delete o[after.found[i][0]]; } catch {} }
  for (let i = 0; i < before.found.length; i++) { try { defineProperty(o, before.found[i][0], before.found[i][1]); } catch {} }
}
const out = [];
for (let i = 0; i < cases.length; i++) {
  const o = cases[i][0](), before = look(o);
  let said;
  try { said = cases[i][1]() === false ? "false" : "ran"; } catch (e) { said = "throws " + (e && e.name); }
  said += changes(before, look(o));
  restore(o, before);
  out[out.length] = said;
}
log(stringify(out));
`;
const table = cases
  .map(({ target, code }) => `  [() => ${target}, () => { ${code.startsWith("Reflect.") ? "return " : ""}${code} }],\n`)
  .join("");

async function bun(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

describe.skipIf(!!unsupported)("writes to built-in objects under --aot", () => {
  test("the run time rejects the writes of its lists", async () => {
    using dir = tempDir("aot-locked-builtins", {
      "package.json": `{ "name": "writes", "type": "module" }`,
      "run.js": `${head}const cases = [\n${table}];\n${runner}`,
      // The same in sloppy mode.
      "run.cjs": `${head}const cases = [\n${table}];\n${runner}module.exports = {};\n`,
    });
    const cwd = String(dir);
    const [plain, compiled, plainSloppy, compiledSloppy] = await Promise.all([
      bun(cwd, "run", "run.js"),
      bun(cwd, "run", "--debug-aot", "run.js"),
      bun(cwd, "run", "run.cjs"),
      bun(cwd, "run", "--debug-aot", "run.cjs"),
    ]);
    const answers = (run: { stdout: string; stderr: string }): string[] => {
      expect(
        run.stderr.split("\n").filter(line => /^(error|warn): /.test(line) && !line.startsWith("warn: TS100014: ")),
      ).toEqual([]);
      return JSON.parse(run.stdout);
    };
    const [was, is, wasSloppy, isSloppy] = [plain, compiled, plainSloppy, compiledSloppy].map(answers);

    // Rejected: it changes nothing, and says so, in sloppy code too. Otherwise it does what it does without `--aot`.
    const verdict = (before: string, now: string) =>
      now === before ? "same" : /^(throws TypeError|false)$/.test(now) ? "rejected" : `${before} | ${now}`;
    const found = cases.map(({ code }, i) => ({
      code,
      run: verdict(was[i], is[i]),
      sloppy: verdict(wasSloppy[i], isSloppy[i]),
    }));
    expect(found).toEqual(cases.map(({ code, run, sloppy }) => ({ code, run, sloppy })));
  }, 120_000);

  test("the check and the build stop at the writes of their lists", async () => {
    const numbered = cases.map((each, i) => ({ ...each, file: `writes/${i}.${each.extension}` }));
    using dir = tempDir("aot-locked-builtins", {
      "package.json": `{ "name": "writes", "type": "module" }`,
      "main.js": numbered
        .filter(({ build }) => build === "same")
        .map(({ file }) => `import "./${file}";\n`)
        .join(""),
      ...Object.fromEntries(numbered.map(({ code, file }) => [file, `${head}${code}\n`])),
    });
    const cwd = String(dir);
    const verdict = (exitCode: number, said: string, errors: string[]) =>
      exitCode === 0 && errors.length === 0
        ? "same"
        : exitCode === 1 && errors.join() === "TS100014 in line 2"
          ? "rejected"
          : said;
    const check = (file: string) =>
      slot(async () => {
        const { stdout, stderr, exitCode } = await bun(cwd, "check", "--aot", "--no-pretty", file);
        return verdict(
          exitCode,
          stdout + stderr,
          Array.from(stdout.matchAll(/\((\d+),\d+\): error (TS\d+): /g), ([, line, code]) => `${code} in line ${line}`),
        );
      });
    const build = (entryPoint: string) =>
      slot(async () => {
        const outfile = entryPoint.replaceAll("/", "-") + ".out";
        const { stderr, exitCode } = await bun(cwd, "build", "--compile", "--aot", entryPoint, "--outfile", outfile);
        rmSync(join(cwd, outfile), { force: true });
        return verdict(
          exitCode,
          stderr,
          Array.from(
            stderr.matchAll(/^error: (TS\d+): .*\n\s+at .*:(\d+):\d+$/gm),
            ([, code, line]) => `${code} in line ${line}`,
          ),
        );
      });

    // Each write is checked alone. One that stops the build is built alone too, and the others are built as one program.
    const stopping = numbered.filter(each => each.build === "rejected");
    const [together, checked, built] = await Promise.all([
      build("main.js"),
      Promise.all(numbered.map(({ file }) => check(file))),
      Promise.all(stopping.map(({ file }) => build(file))),
    ]);
    expect(numbered.map(({ code }, i) => ({ code, build: checked[i] }))).toEqual(
      numbered.map(({ code, build }) => ({ code, build })),
    );
    expect(stopping.map(({ code }, i) => ({ code, build: built[i] }))).toEqual(
      stopping.map(({ code, build }) => ({ code, build })),
    );
    expect(together).toBe("same");
  }, 390_000);

  test.todo(
    "the build reports each of two writes to one member: of `Math.max = f; delete Math.max;` it reports the first alone",
  );
  test.todo(
    "the build stops at `Object.setPrototypeOf(Math, {})`, `Object.assign(Array, { from: f })`, `Array.prototype[0] = f`, `Array.prototype.length = 3` and `globalThis.globalThis = f`, which always throw",
  );
  test.todo(
    "a store to __proto__ that changes nothing does not throw: `Array.prototype.__proto__ = Object.prototype`, `Array.prototype.__proto__ = 1`",
  );
});
