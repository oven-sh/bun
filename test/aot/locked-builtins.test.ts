// Under `--aot` the built-in objects are immutable, and three parts of Bun say so:
//   - `bun build --compile --aot` stops with TS100014 at a write that always runs and always fails;
//   - the compiled program throws a TypeError where the write runs, or `Reflect.*` returns false;
//   - `bun lint` reports the write (bun/aot-locked-builtin-write).
// All three read src/sema/check/aot/locked_builtins_generated.rs. Here each write below goes through all three, and through plain
// Bun, and they have to agree: refused by `--aot` alone, or the same with and without it.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { unsupported } from "./run-programs";

// `f` is a function and `d` a property descriptor. Before the `|`: the object that the write is about.
const refused = `
globalThis | Array = f;
globalThis | globalThis.Array = f;
globalThis | delete globalThis.Array;
globalThis | Object.defineProperty(globalThis, "Array", d);
globalThis | Reflect.set(globalThis, "Array", f);
globalThis | Reflect.defineProperty(globalThis, "Array", d);
globalThis | Reflect.deleteProperty(globalThis, "Array");
globalThis | Proxy = f;
globalThis | globalThis.Proxy = f;
globalThis | delete globalThis.Proxy;
globalThis | Intl = f;
globalThis | globalThis.Intl = f;
globalThis | WebAssembly = f;
globalThis | globalThis.WebAssembly = f;
globalThis | globalThis.Temporal = f;
globalThis | globalThis.ShadowRealm = f;
globalThis | Iterator = f;
globalThis | globalThis.Iterator = f;
globalThis | Atomics = f;
globalThis | globalThis.eval = f;
globalThis | parseInt = f;
globalThis | globalThis.parseInt = f;
globalThis | globalThis.globalThis = f;
globalThis | Promise = f;
globalThis | Uint8Array = f;
globalThis | Object.assign(globalThis, { Date: f });
globalThis | globalThis.Promise = Map;
Array.prototype | Array.prototype.zzz = f;
Array.prototype | Array.prototype["zzz"] = f;
Array.prototype | Array.prototype[0] = f;
Array.prototype | Array.prototype[Symbol.for("zzz")] = f;
Array.prototype | Array.prototype[Symbol.toPrimitive] = f;
Array.prototype | Array.prototype[Symbol.toStringTag] = "T";
Object.prototype | Object.prototype[Symbol.toPrimitive] = f;
Map.prototype | Map.prototype[Symbol.hasInstance] = f;
Array.prototype | Array.prototype.prototype = f;
Function.prototype | Function.prototype.prototype = f;
Array.prototype | Array.prototype.BYTES_PER_ELEMENT = 1;
Array.prototype | Object.defineProperty(Array.prototype, "zzz", d);
Array.prototype | Object.defineProperties(Array.prototype, { zzz: d });
Array.prototype | Object.assign(Array.prototype, { zzz: f });
Array.prototype | Reflect.set(Array.prototype, "zzz", f);
Array.prototype | Reflect.defineProperty(Array.prototype, "zzz", d);
Object.prototype | Object.prototype.zzz = f;
Object.prototype | Object.defineProperty(Object.prototype, "zzz", d);
Function.prototype | Function.prototype.zzz = f;
String.prototype | String.prototype.zzz = f;
Promise.prototype | Promise.prototype.zzz = f;
Iterator.prototype | Iterator.prototype.zzz = f;
Uint8Array.prototype | Uint8Array.prototype.zzz = f;
Intl.Collator.prototype | Intl.Collator.prototype.zzz = f;
Intl.DateTimeFormat.prototype | Object.defineProperty(Intl.DateTimeFormat.prototype, "zzz", d);
WebAssembly.Module.prototype | WebAssembly.Module.prototype.zzz = f;
Temporal.PlainDate.prototype | Temporal.PlainDate.prototype.zzz = f;
ShadowRealm.prototype | ShadowRealm.prototype.zzz = f;
Array.prototype | Array.prototype.push = f;
Array.prototype | delete Array.prototype.push;
Array.prototype | Object.defineProperty(Array.prototype, "push", d);
Array.prototype | Reflect.set(Array.prototype, "push", f);
Array.prototype | Reflect.deleteProperty(Array.prototype, "push");
Array.prototype | Object.assign(Array.prototype, { push: f });
Array.prototype | Array.prototype[Symbol.iterator] = f;
Array.prototype | delete Array.prototype[Symbol.iterator];
Array.prototype | Array.prototype.constructor = f;
Array.prototype | Array.prototype.toString = f;
Array.prototype | Array.prototype.hasOwnProperty = f;
Array.prototype | Object.defineProperty(Array.prototype, "hasOwnProperty", d);
Array.prototype | Array.prototype.length = 3;
Object.prototype | Object.prototype.toString = f;
Object.prototype | delete Object.prototype.hasOwnProperty;
Map.prototype | Object.defineProperty(Map.prototype, "size", d);
Map.prototype | delete Map.prototype.size;
Map.prototype | Object.defineProperty(Map.prototype, Symbol.toStringTag, d);
Uint8Array.prototype | Uint8Array.prototype.set = f;
Uint8Array.prototype | Uint8Array.prototype.toBase64 = f;
Intl.NumberFormat.prototype | Intl.NumberFormat.prototype.formatToParts = f;
WebAssembly.Memory.prototype | WebAssembly.Memory.prototype.grow = f;
Temporal.Duration.prototype | Temporal.Duration.prototype.add = f;
Date.prototype | Date.prototype.getTime = f;
Date.prototype | Object.defineProperty(Date.prototype, Symbol.toPrimitive, d);
RegExp.prototype | RegExp.prototype.exec = f;
Array | Array.from = f;
Array | Array.isArray = f;
Array | delete Array.from;
Array | Object.defineProperty(Array, "from", d);
Array | Reflect.set(Array, "from", f);
Array | Object.assign(Array, { from: f });
Array | Object.defineProperty(Array, Symbol.species, d);
Math | Math.max = f;
Math | delete Math.max;
Math | Object.defineProperty(Math, "max", d);
Math | Math.random = f;
Math | Math.max = Math.min;
Math | Math.max += 1;
Math | globalThis.Math.max = f;
JSON | JSON.parse = f;
Reflect | Reflect.get = f;
Atomics | Atomics.add = f;
Date | Date.now = f;
Object | Object.keys = f;
Object | Object.hasOwn = f;
Number | Number.isNaN = f;
Promise | Promise.resolve = f;
Symbol | Symbol.for = f;
Proxy | Proxy.revocable = f;
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
Intl | Intl.toString = f;
Uint8Array | Uint8Array.from = f;
Uint8Array | Uint8Array.of = f;
Uint8Array | Object.defineProperty(Uint8Array, "from", d);
TypeError | TypeError.captureStackTrace = f;
AggregateError | AggregateError.isError = f;
Intl.Collator | Intl.Collator.apply = f;
parseInt | parseInt.call = f;
parseInt | Object.setPrototypeOf(parseInt, {});
eval | eval.toString = f;
Array.prototype | Object.setPrototypeOf(Array.prototype, {});
Array.prototype | Reflect.setPrototypeOf(Array.prototype, {});
Array.prototype | Array.prototype.__proto__ = {};
Array.prototype | Array.prototype.__proto__ = null;
Array | Object.setPrototypeOf(Array, {});
Array | Array.__proto__ = {};
Math | Object.setPrototypeOf(Math, {});
Intl.Collator | Object.setPrototypeOf(Intl.Collator, {});
Array.prototype | if (!Array.prototype.zzz) Array.prototype.zzz = f;
Array.prototype | if (typeof Array.prototype.zzz !== "function") Array.prototype.zzz = f;
Array.prototype | if (!("zzz" in Array.prototype)) Array.prototype.zzz = f;
Array.prototype | Array.prototype.zzz || (Array.prototype.zzz = f);
Array.prototype | Array.prototype.zzz ||= f;
Array.prototype | Array.prototype.zzz ??= f;
Array.prototype | Array.prototype.flat &&= f;
Array.prototype | if (Array.prototype.flat) Array.prototype.flat = f;
Array.prototype | if (!Array.prototype.flat || !Array.prototype.zzz) Array.prototype.zzz = f;
Array.prototype | if (typeof Math === "object") Array.prototype.zzz = f;
Temporal | if (typeof Temporal.Now !== "function") Temporal.Now = f;
Array.prototype | { const P = Array.prototype; P.zzz = f; }
Array.prototype | { const P = Array.prototype; P.push = f; }
Array.prototype | { const P = Array.prototype; Object.defineProperty(P, "zzz", d); }
Array.prototype | { const P = Array.prototype; delete P.push; }
Array.prototype | globalThis.Array.prototype.zzz = f;
Array.prototype | Array.prototype.zzz++;
`;

const same = `
Error.prototype | Error.prototype.zzz = f;
Error.prototype | Error.prototype.name = "x";
Error.prototype | Error.prototype.message = "x";
TypeError.prototype | TypeError.prototype.toString = f;
Error.prototype | if (!Error.prototype.message) Error.prototype.message = "x";
Error.prototype | Error.prototype.message ||= "x";
Error.prototype | Error.prototype.name &&= "x";
Error.prototype | if (typeof Error.prototype.name !== "function") Error.prototype.name = "x";
globalThis | globalThis.undefined = 1;
globalThis | globalThis.NaN = 1;
globalThis | globalThis.Infinity = 1;
globalThis | console = f;
globalThis | globalThis.console = f;
globalThis | globalThis.Buffer = f;
globalThis | globalThis.process = f;
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
Map.prototype | Map.prototype.size = 1;
Uint8Array.prototype | Uint8Array.prototype.buffer = f;
Uint8Array.prototype | Reflect.set(Uint8Array.prototype, "byteLength", f);
Float64Array.prototype | Float64Array.prototype[Symbol.toStringTag] = f;
Function.prototype | Function.prototype.arguments = f;
Function.prototype | Reflect.set(Function.prototype, "arguments", f);
Function.prototype | Function.prototype.caller = f;
Function.prototype | Reflect.set(Function.prototype, "caller", f);
Iterator.prototype | Iterator.prototype.constructor = f;
Iterator.prototype | Reflect.set(Iterator.prototype, "constructor", f);
Iterator.prototype | Iterator.prototype[Symbol.toStringTag] = f;
Iterator.prototype | Reflect.set(Iterator.prototype, Symbol.toStringTag, f);
WebAssembly.Global.prototype | WebAssembly.Global.prototype.value = f;
WebAssembly.Global.prototype | Reflect.set(WebAssembly.Global.prototype, "value", f);
Map.prototype | Map.prototype[Symbol.toStringTag] = "x";
Uint8Array.prototype | Uint8Array.prototype.BYTES_PER_ELEMENT = 2;
Intl.Collator.prototype | Intl.Collator.prototype.compare = f;
Date.prototype | Date.prototype[Symbol.toPrimitive] = f;
RegExp.prototype | RegExp.prototype.flags = "g";
Symbol.prototype | Symbol.prototype.description = "x";
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
Array | Array.prototype = {};
Array | delete Array.prototype;
Array | Array.name = "x";
Array | Object.defineProperty(Array, "name", d);
Array | delete Array.name;
Array | Array.length = 3;
Array | Object.defineProperty(Array, "length", d);
Array | Array[Symbol.species] = f;
Math | Math.PI = 3;
Math | delete Math.PI;
Math | Math.PI++;
Number | Number.MAX_SAFE_INTEGER = 1;
Symbol | Symbol.iterator = f;
Error | Error.stackTraceLimit = 5;
Error | Error.prepareStackTrace = f;
Error | delete Error.stackTraceLimit;
TypeError | TypeError.stackTraceLimit = 5;
Uint8Array | Uint8Array.BYTES_PER_ELEMENT = 2;
Array.prototype | Array.prototype.__proto__ = 1;
Array.prototype | Array.prototype.__proto__ = Object.prototype;
Array.prototype | Object.setPrototypeOf(Array.prototype, Object.prototype);
Array | Object.setPrototypeOf(Array, Function.prototype);
Object.prototype | Object.setPrototypeOf(Object.prototype, {});
Math | Math.max = Math.max;
Math | Reflect.set(Math, "max", Math.max);
Intl | Intl.Collator = Intl.Collator;
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
Math | Object.freeze(Math);
Array | Object.seal(Array);
`;

const rowsOf = (list: string) =>
  list
    .trim()
    .split("\n")
    .map(line => line.split(" | ") as [string, string]);
const rows = [...rowsOf(refused), ...rowsOf(same)];
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
for (let i = 0; i < rows.length; i++) {
  const o = rows[i][0](), before = look(o);
  let said;
  try { said = rows[i][1]() === false ? "false" : "ran"; } catch (e) { said = "throws " + (e && e.name); }
  said += changes(before, look(o));
  restore(o, before);
  out[out.length] = said;
}
log(stringify(out));
`;
const table = rows
  .map(([target, code]) => `  [() => ${target}, () => { ${code.startsWith("Reflect.") ? "return " : ""}${code} }],\n`)
  .join("");

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!!unsupported)("writes to built-in objects under --aot", () => {
  test("the build, the run and the lint rule agree", async () => {
    using dir = tempDir("aot-locked-builtins", {
      "package.json": `{ "name": "writes", "type": "module" }`,
      "bunfig.toml": `[lint.rules]\n"bun/aot-locked-builtin-write" = "error"\n`,
      "run.js": `${head}const rows = [\n${table}];\n${runner}`,
      // The same in sloppy mode.
      "run.cjs": `${head}const rows = [\n${table}];\n${runner}module.exports = {};\n`,
      "writes/main.js": rows.map((_, i) => `import "./${i}.js";\n`).join(""),
      ...Object.fromEntries(rows.map(([, code], i) => [`writes/${i}.js`, `${head}${code}\n`])),
    });
    const cwd = String(dir);
    const [plain, compiled, plainSloppy, compiledSloppy, build, lint] = await Promise.all([
      bun(cwd, "run", "run.js"),
      bun(cwd, "run", "--debug-aot", "run.js"),
      bun(cwd, "run", "run.cjs"),
      bun(cwd, "run", "--debug-aot", "run.cjs"),
      bun(cwd, "build", "--compile", "--aot", "writes/main.js", "--outfile", "writes.out"),
      bun(cwd, "lint", "--no-ignore", "-f", "json", "writes"),
    ]);
    const answers = (run: { stdout: string; stderr: string }): string[] => {
      expect(run.stderr).toBe("");
      return JSON.parse(run.stdout);
    };
    const [was, is, wasSloppy, isSloppy] = [plain, compiled, plainSloppy, compiledSloppy].map(answers);

    const stopped = new Set<number>();
    for (const [, code, file] of build.stderr.matchAll(/^error: (TS\d+): .*\n\s+at .*[\\/](\d+)\.js:2:\d+$/gm)) {
      expect(code).toBe("TS100014");
      stopped.add(Number(file));
    }
    const reported = new Set<number>();
    for (const { filePath, messages } of JSON.parse(lint.stdout) as {
      filePath: string;
      messages: { ruleId: string }[];
    }[]) {
      if (messages.some(it => it.ruleId === "bun/aot-locked-builtin-write"))
        reported.add(Number(/(\d+)\.js$/.exec(filePath)?.[1]));
    }

    // Refused: it changes nothing, and says so. Otherwise it does what it does without `--aot`.
    const verdict = (before: string, now: string) =>
      now === before ? "same" : /^(throws TypeError|false)$/.test(now) ? "refused" : `${before} | ${now}`;
    const found = rows.map(([, code], i) => ({
      code,
      build: stopped.has(i) ? "refused" : "same",
      run: verdict(was[i], is[i]),
      sloppy: verdict(wasSloppy[i], isSloppy[i]),
      lint: reported.has(i) ? "refused" : "same",
    }));
    const expected = rows.map(([, code], i) => {
      const all = i < rowsOf(refused).length ? "refused" : "same";
      return { code, build: all, run: all, sloppy: all, lint: all };
    });
    expect(found).toEqual(expected);
    expect(build.exitCode).toBe(1);
  }, 120_000);
});
