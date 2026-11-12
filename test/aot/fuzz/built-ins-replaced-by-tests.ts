// A test replaces a built-in: `Date.now = () => 5`, `spyOn(Math, "floor")`, `Object.defineProperty(process, "platform", ..)`. Code that
// was compiled on the word that `Date.now` is the built-in has to call the replacement, and the built-in again once it is put back.
// A compiled test run decides what may be replaced by looking at its files, so each scene varies what the look has to see: which
// member (of a global, a prototype, a library module), how it is replaced (a store, a name made at run time, defineProperty,
// Reflect.set, Object.assign, a spy, an alias, a helper here or in another file, a value that nobody follows, a text that is run, a
// getter, delete), where the code that uses it stands (the test file, a file it imports), and when (while the file loads, in a test).
// Other scenes only hold texts that look like programs, whole or broken, which such a look may read.
//
// Only for run-as-tests.ts: the programs import bun:test.
import type { Random } from "./random";

/** What the fake makes of the real answer. `constant`: the real answer differs from run to run. `count`: it only counts the calls. */
type Kind = "number" | "string" | "boolean" | "list" | "constant" | "count";
interface Target {
  holder: string;
  /** A name, or `@@iterator` and the like. */
  name: string;
  kind: Kind;
  /** Expressions. */
  uses: string[];
  /** `node:fs`: the holder is its default import. */
  module?: string;
  /** The real one may not be called here: it ends the process, waits, or answers otherwise each time. */
  isOnlyUsedReplaced?: true;
}

const target = (holder: string, name: string, kind: Kind, ...uses: string[]): Target => ({ holder, name, kind, uses });
const ofModule = (module: string, name: string, kind: Kind, ...uses: string[]): Target => ({
  holder: module.replace(/\W/g, "_"),
  name,
  kind,
  uses,
  module: "node:" + module,
});
const replacedOnly = (from: Target): Target => ({ ...from, isOnlyUsedReplaced: true });

const targets: Target[] = [
  target("Math", "floor", "number", "Math.floor(7.5)", "[1.5, 2.5].map(Math.floor)", "sumOf(i => Math.floor(i / 3))"),
  target("Math", "abs", "number", "Math.abs(-3)", "sumOf(i => Math.abs(i - 5))"),
  target("Math", "max", "number", "Math.max(1, 2)", "Math.max(...[1, 2, 3])", "sumOf(i => Math.max(i, 4))"),
  target("Math", "min", "number", "Math.min(1, 2)", "sumOf(i => Math.min(i, 4))"),
  target("Math", "round", "number", "Math.round(2.5)", "sumOf(i => Math.round(i / 4))"),
  target("Math", "trunc", "number", "Math.trunc(-2.5)"),
  target("Math", "ceil", "number", "Math.ceil(2.1)"),
  target("Math", "sqrt", "number", "Math.sqrt(16)", "sumOf(i => Math.sqrt(i * i))"),
  target("Math", "pow", "number", "Math.pow(2, 5)"),
  target("Math", "imul", "number", "Math.imul(3, 4)"),
  target("Math", "sign", "number", "Math.sign(-9)"),
  target("Math", "hypot", "number", "Math.hypot(3, 4)"),
  target("Math", "random", "constant", "typeof Math.random()", "Math.random() < 2"),
  target("Date", "now", "constant", "typeof Date.now()", "Date.now() > 1000"),
  target("Date", "parse", "number", 'Date.parse("1970-01-01T00:00:01Z")'),
  target("Date", "UTC", "number", "Date.UTC(1970, 0, 1, 0, 0, 2)"),
  target("Date.prototype", "getTime", "number", "new Date(5).getTime()", "sumOf(i => new Date(i).getTime())"),
  target("Date.prototype", "valueOf", "number", "+new Date(5)", "new Date(5) - 0", "new Date(5) > new Date(4)"),
  target("Date.prototype", "toISOString", "string", "new Date(0).toISOString()", "JSON.stringify(new Date(0))"),
  target(
    "Date.prototype",
    "toJSON",
    "string",
    "JSON.stringify(new Date(0))",
    "JSON.stringify([new Date(0)])",
    "JSON.stringify({ at: new Date(0) })",
    "new Date(0).toJSON()",
  ),
  target("Date.prototype", "getUTCFullYear", "number", "new Date(0).getUTCFullYear()"),
  target("JSON", "stringify", "string", "JSON.stringify({ a: 1 })", "JSON.stringify([1, 2])", 'JSON.stringify("text")'),
  target("JSON", "parse", "list", 'JSON.parse("[1,2]")'),
  target("Object", "keys", "list", "Object.keys({ a: 1, b: 2 })", "Object.keys([7, 8])", "Object.keys(record)"),
  target("Object", "values", "list", "Object.values({ a: 1, b: 2 })", "Object.values(record)"),
  target("Object", "entries", "list", "Object.entries({ a: 1 })", "Object.entries(record)"),
  target("Object", "getOwnPropertyNames", "list", "Object.getOwnPropertyNames({ a: 1 })"),
  target("Object", "hasOwn", "boolean", 'Object.hasOwn({ a: 1 }, "a")', 'Object.hasOwn(record, "first")'),
  target("Object", "is", "boolean", "Object.is(0, -0)", "Object.is(NaN, NaN)"),
  target("Object", "isFrozen", "boolean", "Object.isFrozen({})", "Object.isFrozen(Object.freeze({}))"),
  target("Object", "freeze", "count", "Object.isFrozen(Object.freeze({ a: 1 }))"),
  target("Object", "assign", "count", "Object.assign({}, { a: 1 })", "Object.assign({ z: 0 }, record)"),
  target("Object", "create", "count", "Object.getPrototypeOf(Object.create(null)) === null"),
  target("Object", "fromEntries", "count", 'Object.fromEntries([["a", 1]])'),
  target("Object", "getPrototypeOf", "count", "Object.getPrototypeOf([]) === Array.prototype"),
  target(
    "Object.prototype",
    "hasOwnProperty",
    "boolean",
    '({ a: 1 }).hasOwnProperty("a")',
    'record.hasOwnProperty("first")',
  ),
  target(
    "Object.prototype",
    "toString",
    "string",
    "String({})",
    "`${{}}`",
    "Object.prototype.toString.call([])",
    '({}) + ""',
  ),
  target("Object.prototype", "valueOf", "count", "({}).valueOf() !== null", "({}) == 1"),
  target("Array", "isArray", "boolean", "Array.isArray([])", "Array.isArray({})", "Array.isArray(list)"),
  target("Array", "from", "list", "Array.from([1, 2])", 'Array.from("ab")', "Array.from({ length: 2 }, (_, i) => i)"),
  target("Array", "of", "list", "Array.of(1, 2)"),
  target(
    "Array.prototype",
    "push",
    "number",
    "[1].push(2)",
    "(() => { const made = []; made.push(1); made.push(2); return made; })()",
  ),
  target("Array.prototype", "pop", "number", "[1, 2].pop()"),
  target("Array.prototype", "shift", "number", "[1, 2].shift()"),
  target("Array.prototype", "map", "list", "[1, 2].map(x => x * 2)", "list.map(x => x + 1)"),
  target("Array.prototype", "filter", "list", "[1, 2, 3].filter(x => x > 1)", "list.filter(x => x & 1)"),
  target(
    "Array.prototype",
    "forEach",
    "count",
    "(() => { let sum = 0; [1, 2].forEach(x => (sum += x)); return sum; })()",
  ),
  target("Array.prototype", "includes", "boolean", "[1, 2].includes(2)", "list.includes(9)"),
  target("Array.prototype", "indexOf", "number", "[1, 2].indexOf(2)", "list.indexOf(3)"),
  target(
    "Array.prototype",
    "join",
    "string",
    "[1, 2].join()",
    'list.join("-")',
    "String([1, 2])",
    "`${[1, 2]}`",
    '[1, 2] + ""',
  ),
  target("Array.prototype", "toString", "string", "String([1, 2])", "`${[3]}`", "[1, 2].toString()"),
  target("Array.prototype", "slice", "list", "[1, 2, 3].slice(1)", "list.slice()"),
  target("Array.prototype", "concat", "list", "[1].concat([2])", "list.concat(9)"),
  target("Array.prototype", "sort", "list", "[2, 1].sort()", "[3, 1, 2].sort((a, b) => a - b)"),
  target("Array.prototype", "reverse", "list", "[1, 2].reverse()"),
  target("Array.prototype", "reduce", "number", "[1, 2].reduce((a, b) => a + b, 0)", "list.reduce((a, b) => a + b)"),
  target("Array.prototype", "find", "number", "[1, 2].find(x => x > 1)"),
  target("Array.prototype", "findIndex", "number", "[1, 2].findIndex(x => x > 1)"),
  target("Array.prototype", "some", "boolean", "[1, 2].some(x => x > 1)"),
  target("Array.prototype", "every", "boolean", "[1, 2].every(x => x > 1)"),
  target("Array.prototype", "at", "number", "[1, 2].at(-1)", "list.at(0)"),
  target("Array.prototype", "flat", "list", "[[1], [2]].flat()"),
  target("Array.prototype", "flatMap", "list", "[1, 2].flatMap(x => [x, x])"),
  target("Array.prototype", "fill", "list", "[0, 0].fill(7)", "new Array(2).fill(1)"),
  target(
    "Array.prototype",
    "@@iterator",
    "count",
    "[...[1, 2]]",
    "(() => { let sum = 0; for (const x of [1, 2]) sum += x; return sum; })()",
    "(([a, b]) => a + b)([1, 2])",
    "Math.max(...list)",
    "new Set([1, 2]).size",
    "Array.from([1, 2])",
    "new Map([[1, 2]]).size",
    "Object.fromEntries([[1, 2]])",
  ),
  target("Array.prototype", "values", "count", "[...[1, 2].values()]", "[...[1, 2]]"),
  target("Array.prototype", "keys", "count", "[...[7, 8].keys()]"),
  target("Array.prototype", "entries", "count", "[...[7].entries()]"),
  target("String.prototype", "slice", "string", '"text".slice(1)', "word.slice(0, 2)"),
  target("String.prototype", "substring", "string", '"text".substring(1)'),
  target("String.prototype", "includes", "boolean", '"text".includes("ex")', 'word.includes("z")'),
  target("String.prototype", "startsWith", "boolean", '"text".startsWith("te")', 'word.startsWith("w")'),
  target("String.prototype", "endsWith", "boolean", '"text".endsWith("xt")'),
  target("String.prototype", "split", "list", '"a,b".split(",")', 'word.split("")'),
  target("String.prototype", "trim", "string", '" a ".trim()'),
  target("String.prototype", "replace", "string", '"aa".replace("a", "b")', '"aa".replace(/a/g, "b")'),
  target("String.prototype", "replaceAll", "string", '"aa".replaceAll("a", "b")'),
  target("String.prototype", "toUpperCase", "string", '"a".toUpperCase()', "word.toUpperCase()"),
  target("String.prototype", "toLowerCase", "string", '"A".toLowerCase()'),
  target("String.prototype", "padStart", "string", '"a".padStart(3, "-")'),
  target("String.prototype", "repeat", "string", '"ab".repeat(2)'),
  target("String.prototype", "concat", "string", '"a".concat("b")'),
  target("String.prototype", "charAt", "string", '"ab".charAt(1)'),
  target("String.prototype", "charCodeAt", "number", "word.charCodeAt(0)", "sumOf(i => word.charCodeAt(i % 4))"),
  target("String.prototype", "codePointAt", "number", '"a".codePointAt(0)'),
  target("String.prototype", "indexOf", "number", '"abc".indexOf("c")', 'word.indexOf("r")'),
  target("String.prototype", "at", "string", '"ab".at(-1)'),
  target("String.prototype", "localeCompare", "number", '"a".localeCompare("b")'),
  target("String.prototype", "toString", "string", 'new String("a").toString()', '`${new String("a")}`'),
  target("String.prototype", "@@iterator", "count", '[..."ab"]', 'Array.from("ab")', '(([a]) => a)("xy")'),
  target("String", "fromCharCode", "string", "String.fromCharCode(97)"),
  target("String", "raw", "string", "String.raw`a${1}b`"),
  target("Number", "parseInt", "number", 'Number.parseInt("12")'),
  target("Number", "parseFloat", "number", 'Number.parseFloat("1.5")'),
  target("Number", "isInteger", "boolean", "Number.isInteger(1)", "Number.isInteger(1.5)"),
  target("Number", "isNaN", "boolean", "Number.isNaN(NaN)"),
  target("Number", "isFinite", "boolean", "Number.isFinite(1)"),
  target("Number", "isSafeInteger", "boolean", "Number.isSafeInteger(2 ** 53)"),
  target("Number.prototype", "toFixed", "string", "(1.25).toFixed(1)"),
  target("Number.prototype", "toString", "string", "(5).toString()", "(255).toString(16)", "`${new Number(5)}`"),
  target("Number.prototype", "valueOf", "number", "new Number(5) + 1", "new Number(5).valueOf()"),
  target("Boolean.prototype", "valueOf", "boolean", "new Boolean(true).valueOf()"),
  target("globalThis", "parseInt", "number", 'parseInt("12")', 'globalThis.parseInt("7")'),
  target("globalThis", "parseFloat", "number", 'parseFloat("1.5")'),
  target("globalThis", "isNaN", "boolean", "isNaN(NaN)"),
  target("globalThis", "isFinite", "boolean", "isFinite(1)"),
  target("globalThis", "encodeURIComponent", "string", 'encodeURIComponent("a b")'),
  target("globalThis", "decodeURIComponent", "string", 'decodeURIComponent("a%20b")'),
  target("globalThis", "btoa", "string", 'btoa("a")'),
  target("globalThis", "atob", "string", 'atob("YQ==")'),
  target("globalThis", "structuredClone", "count", "structuredClone({ a: 1 })"),
  replacedOnly(target("globalThis", "queueMicrotask", "count", "queueMicrotask(() => {})")),
  replacedOnly(
    target(
      "globalThis",
      "setTimeout",
      "count",
      "typeof setTimeout(() => {}, 1)",
      "typeof globalThis.setTimeout(() => {}, 1)",
    ),
  ),
  replacedOnly(target("globalThis", "setInterval", "count", "typeof setInterval(() => {}, 1)")),
  replacedOnly(target("globalThis", "clearTimeout", "count", "clearTimeout(0)")),
  replacedOnly(target("globalThis", "fetch", "count", 'typeof fetch("http://localhost:1/")')),
  target("Map.prototype", "get", "number", "new Map([[1, 2]]).get(1)", "table.get(1)", "sumOf(i => table.get(i % 2))"),
  target("Map.prototype", "has", "boolean", "new Map([[1, 2]]).has(1)", "table.has(5)"),
  target("Map.prototype", "set", "count", "new Map().set(1, 2).size", "new Map([[1, 2]]).size"),
  target("Map.prototype", "delete", "boolean", "new Map([[1, 2]]).delete(1)"),
  target(
    "Map.prototype",
    "forEach",
    "count",
    "(() => { let sum = 0; table.forEach(value => (sum += value)); return sum; })()",
  ),
  target("Map.prototype", "keys", "count", "[...table.keys()]"),
  target("Map.prototype", "values", "count", "[...table.values()]"),
  target("Map.prototype", "entries", "count", "[...table.entries()]", "[...table]"),
  target(
    "Map.prototype",
    "@@iterator",
    "count",
    "[...table]",
    "(() => { let sum = 0; for (const [key] of table) sum += key; return sum; })()",
    "new Map(table).size",
  ),
  target(
    "Set.prototype",
    "has",
    "boolean",
    "new Set([1]).has(1)",
    "group.has(5)",
    "sumOf(i => (group.has(i) ? 1 : 0))",
  ),
  target("Set.prototype", "add", "count", "new Set().add(1).size", "new Set([1, 2]).size"),
  target("Set.prototype", "delete", "boolean", "new Set([1]).delete(1)"),
  target(
    "Set.prototype",
    "forEach",
    "count",
    "(() => { let sum = 0; group.forEach(value => (sum += value)); return sum; })()",
  ),
  target("Set.prototype", "values", "count", "[...group.values()]", "[...group]"),
  target(
    "Set.prototype",
    "@@iterator",
    "count",
    "[...group]",
    "(() => { let sum = 0; for (const value of group) sum += value; return sum; })()",
    "Array.from(group)",
  ),
  target("WeakMap.prototype", "get", "number", "(key => new WeakMap([[key, 1]]).get(key))({})"),
  target("WeakMap.prototype", "has", "boolean", "(key => new WeakMap([[key, 1]]).has(key))({})"),
  target("RegExp.prototype", "test", "boolean", '/a/.test("a")', '/z/.test("a")'),
  target(
    "RegExp.prototype",
    "exec",
    "count",
    '/a/.exec("a")[0]',
    '/a/.test("a")',
    '"a".match(/a/)[0]',
    '"a".replace(/a/, "b")',
    '"a,b".split(/,/)',
  ),
  target("RegExp.prototype", "@@replace", "string", '"a".replace(/a/, "b")', '"aa".replaceAll(/a/g, "b")'),
  target("RegExp.prototype", "@@match", "count", '"a".match(/a/)[0]'),
  target("RegExp.prototype", "@@split", "list", '"a,b".split(/,/)'),
  target("RegExp.prototype", "toString", "string", "String(/a/g)", "`${/a/}`"),
  target("Function.prototype", "call", "count", "(function () { return this; }).call(5) + 0", "plus.call(null, 1, 2)"),
  target("Function.prototype", "apply", "count", "plus.apply(null, [1, 2])", "Math.max.apply(null, [1, 2])"),
  target("Function.prototype", "bind", "count", "plus.bind(null, 1)(2)"),
  target("Function.prototype", "toString", "string", "typeof String(plus)", "String(plus).length > 0"),
  target("Reflect", "ownKeys", "list", "Reflect.ownKeys({ a: 1 })"),
  target("Reflect", "has", "boolean", 'Reflect.has({ a: 1 }, "a")'),
  target("Reflect", "get", "number", 'Reflect.get({ a: 1 }, "a")'),
  target("Reflect", "apply", "number", "Reflect.apply(plus, null, [1, 2])"),
  target("Error.prototype", "toString", "string", 'String(new Error("x"))', '`${new TypeError("y")}`'),
  target("Error", "captureStackTrace", "count", "Error.captureStackTrace({})"),
  target("Symbol", "for", "count", 'Symbol.for("a") === Symbol.for("a")'),
  target("Promise", "resolve", "count", "typeof Promise.resolve(1)"),
  target("Promise.prototype", "then", "count", "typeof Promise.resolve(1).then(() => {})"),
  replacedOnly(target("console", "log", "count", 'console.log("to the fake")')),
  replacedOnly(target("console", "warn", "count", 'console.warn("to the fake")')),
  replacedOnly(target("console", "error", "count", 'console.error("to the fake")')),
  replacedOnly(target("console", "info", "count", 'console.info("to the fake")')),
  replacedOnly(target("console", "debug", "count", 'console.debug("to the fake")')),
  target("process", "cwd", "string", "typeof process.cwd()", 'process.cwd().endsWith("!")'),
  target("process", "uptime", "constant", "typeof process.uptime()"),
  target("process", "hrtime", "constant", "typeof process.hrtime()"),
  replacedOnly(target("process", "exit", "count", "process.exit(3)")),
  replacedOnly(target("process", "nextTick", "count", "process.nextTick(() => {})")),
  replacedOnly(target("process", "emitWarning", "count", 'process.emitWarning("w")')),
  replacedOnly(target("process", "kill", "count", "process.kill(0, 0)")),
  replacedOnly(target("process.stdout", "write", "count", 'process.stdout.write("to the fake")')),
  replacedOnly(target("process.stderr", "write", "count", 'process.stderr.write("to the fake")')),
  target("performance", "now", "constant", "typeof performance.now()"),
  target("crypto", "randomUUID", "constant", "typeof crypto.randomUUID()"),
  target("Bun", "inspect", "string", "Bun.inspect({ a: 1 })"),
  target("Bun", "deepEquals", "boolean", "Bun.deepEquals({ a: 1 }, { a: 1 })"),
  target("Bun", "escapeHTML", "string", 'Bun.escapeHTML("<a>")'),
  target("Bun", "stringWidth", "number", 'Bun.stringWidth("ab")'),
  target("Bun", "nanoseconds", "constant", "typeof Bun.nanoseconds()"),
  target("Bun", "which", "constant", 'typeof Bun.which("sh")'),
  replacedOnly(target("Bun", "sleep", "count", "typeof Bun.sleep(1)")),
  replacedOnly(target("Bun", "spawnSync", "count", 'typeof Bun.spawnSync(["none"])')),
  replacedOnly(target("Bun", "write", "count", 'typeof Bun.write("none", "")')),
  target("Buffer", "from", "count", 'Buffer.from("a").length'),
  target("Buffer", "byteLength", "number", 'Buffer.byteLength("ab")'),
  target("Buffer", "isBuffer", "boolean", 'Buffer.isBuffer(Buffer.from("a"))'),
  target("Buffer", "concat", "count", 'Buffer.concat([Buffer.from("a")]).length'),
  target(
    "Buffer.prototype",
    "toString",
    "string",
    'Buffer.from("a").toString()',
    '`${Buffer.from("b")}`',
    'Buffer.from("a").toString("hex")',
  ),
  target("TextEncoder.prototype", "encode", "count", 'new TextEncoder().encode("a").length'),
  target("TextDecoder.prototype", "decode", "string", "new TextDecoder().decode(new Uint8Array([97]))"),
  target("URL.prototype", "toString", "string", 'new URL("http://a/b").toString()', '`${new URL("http://a/")}`'),
  target("URLSearchParams.prototype", "get", "string", 'new URLSearchParams("a=1").get("a")'),
  target("Headers.prototype", "get", "string", 'new Headers({ a: "1" }).get("a")'),
  target("EventTarget.prototype", "dispatchEvent", "boolean", 'new EventTarget().dispatchEvent(new Event("e"))'),
  target(
    "AbortController.prototype",
    "abort",
    "count",
    "(made => (made.abort(), made.signal.aborted))(new AbortController())",
  ),
  target("Uint8Array.prototype", "slice", "count", "new Uint8Array([1, 2]).slice(1).length"),
  target("Uint8Array.prototype", "set", "count", "(made => (made.set([5]), made[0]))(new Uint8Array(1))"),
  ofModule("fs", "existsSync", "boolean", 'fs.existsSync("/")', 'fs.existsSync("/none/at/all")'),
  ofModule("fs", "statSync", "count", 'fs.statSync("/").isDirectory()'),
  replacedOnly(ofModule("fs", "readFileSync", "count", 'typeof fs.readFileSync("/none/at/all")')),
  replacedOnly(ofModule("fs", "writeFileSync", "count", 'fs.writeFileSync("/none/at/all", "")')),
  replacedOnly(ofModule("fs", "mkdirSync", "count", 'fs.mkdirSync("/none/at/all")')),
  replacedOnly(ofModule("fs", "readdirSync", "count", 'typeof fs.readdirSync("/none/at/all")')),
  ofModule("path", "join", "string", 'path.join("a", "b")'),
  ofModule("path", "basename", "string", 'path.basename("/a/b.js")'),
  ofModule("path", "dirname", "string", 'path.dirname("/a/b.js")'),
  ofModule("path", "extname", "string", 'path.extname("b.js")'),
  ofModule("path", "isAbsolute", "boolean", 'path.isAbsolute("/a")'),
  ofModule("path", "normalize", "string", 'path.normalize("/a/../b")'),
  ofModule("os", "platform", "string", "typeof os.platform()", 'os.platform().endsWith("!")'),
  ofModule("os", "homedir", "string", 'os.homedir().endsWith("!")'),
  ofModule("os", "tmpdir", "string", 'os.tmpdir().endsWith("!")'),
  ofModule("os", "hostname", "string", 'os.hostname().endsWith("!")'),
  ofModule("util", "inspect", "string", "util.inspect({ a: 1 })"),
  ofModule("util", "format", "string", 'util.format("%s", 1)'),
  ofModule("util", "isDeepStrictEqual", "boolean", "util.isDeepStrictEqual([1], [1])"),
  ofModule("url", "fileURLToPath", "string", 'url.fileURLToPath("file:///a/b")'),
  ofModule("querystring", "stringify", "string", "querystring.stringify({ a: 1 })"),
  ofModule("assert", "ok", "count", "assert.ok(1)"),
  ofModule("assert", "strictEqual", "count", "assert.strictEqual(1, 1)"),
  replacedOnly(ofModule("child_process", "execSync", "count", 'typeof child_process.execSync("none")')),
  replacedOnly(ofModule("child_process", "spawnSync", "count", 'typeof child_process.spawnSync("none")')),
  ofModule("crypto", "randomBytes", "constant", "typeof crypto.randomBytes(1)"),
  ofModule("crypto", "randomUUID", "constant", "typeof crypto.randomUUID()"),
  ofModule("events", "once", "count", "typeof events.once"),
  ofModule("zlib", "gzipSync", "count", 'zlib.gunzipSync(zlib.gzipSync("a")).length'),
];

/** `H` the holder, `K` the key as an expression, `D` `.name` or `[key]`, `F` the fake, `@` the number of the scene. */
interface Way {
  replace: string;
  /** Otherwise the descriptor that was there is defined again. */
  restore?: string;
  imports?: string[];
  isOnlyForNames?: true;
  /** The text is run in the global scope, where an import is not seen. */
  isOnlyForGlobals?: true;
  usesHelperFile?: true;
  /** The use then finds what the holder inherits, which may be the real one. */
  uncoversWhatIsAbove?: true;
}
const ways: Way[] = [
  { replace: "HD = F;", restore: "HD = real@;" },
  { replace: "HD = F;", restore: "HD = real@;" },
  { replace: "HD = F;" },
  { replace: "H[K] = F;" },
  { replace: "H[made(K)] = F;", isOnlyForNames: true },
  { replace: "Object.defineProperty(H, K, { value: F, writable: true, configurable: true });" },
  { replace: "Object.defineProperty(H, K, { value: F, writable: true, configurable: true, enumerable: false });" },
  { replace: "Object.defineProperty(H, K, { get() { return fake@; }, configurable: true });\n  const fake@ = F;" },
  { replace: "Object.defineProperties(H, { [K]: { value: F, writable: true, configurable: true } });" },
  { replace: "Reflect.set(H, K, F);" },
  { replace: "Reflect.defineProperty(H, K, { value: F, writable: true, configurable: true });" },
  { replace: "Object.assign(H, { [K]: F });" },
  { replace: "const spy@ = spyOn(H, K).mockImplementation(F);", restore: "spy@.mockRestore();", imports: ["spyOn"] },
  { replace: "const spy@ = spyOn(H, K).mockImplementation(F);", restore: "spy@.mockRestore();", imports: ["spyOn"] },
  {
    replace: "const spy@ = spyOn(H, K);\n  spy@.mockImplementation(F);",
    restore: "mock.restore();",
    imports: ["spyOn", "mock"],
  },
  { replace: "jest.spyOn(H, K).mockImplementation(F);", restore: "jest.restoreAllMocks();", imports: ["jest"] },
  { replace: "vi.spyOn(H, K).mockImplementation(F);", restore: "vi.restoreAllMocks();", imports: ["vi"] },
  { replace: "HD = mock(F);", imports: ["mock"] },
  { replace: "HD = jest.fn(F);", imports: ["jest"] },
  { replace: "const alias@ = H;\n  alias@D = F;" },
  { replace: "const { holder: alias@ } = { holder: H };\n  alias@[K] = F;" },
  { replace: "put(H, K, F);" },
  { replace: "putElsewhere(H, K, F);", usesHelperFile: true },
  { replace: "(await Promise.all([H]))[0][K] = F;" },
  { replace: "[H].map(each => (each[K] = F));" },
  { replace: 'new Function("fake", "HD = fake;")(F);', isOnlyForGlobals: true },
  { replace: '(0, eval)("(fake) => { HD = fake; }")(F);', isOnlyForGlobals: true },
  { replace: "for (const name of [K]) H[name] = F;" },
  { replace: "delete HD;", uncoversWhatIsAbove: true },
];

const changes: Record<Kind, string> = {
  number: "answer + 1000",
  string: 'answer + "!"',
  boolean: "!answer",
  list: "andMore(answer)",
  constant: '"a constant"',
  count: "answer",
};

/** Texts that a look at the files of a test run may take for code. `$` is a substitution where the text is a template. */
const texts = [
  "import a from $; a.run(1.5);",
  "import { a } from '$'; a();",
  "import $ from 'x';",
  "import * as $ from './none.js';",
  "import('$').then(m => m.run());",
  "import {",
  "import",
  "import a, from;",
  "export default $;",
  "export { $ as default };",
  "export * from $",
  "const x = require($); x.y = 1;",
  "require('$').z = () => {};",
  "Date.now = () => $;",
  "$.now = () => 5;",
  "Date.$ = () => 5;",
  "Math.floor = $",
  "globalThis[$] = 1;",
  "globalThis.$ = 1;",
  "spyOn($, 'floor');",
  "spyOn(Math, $);",
  "spyOn(Math, '$').mockReturnValue(1);",
  "mock.module($, () => ({}));",
  "mock.module('$', () => ({ default: 1 }));",
  "jest.mock('$');",
  "Object.defineProperty($, 'platform', { value: 'x' });",
  "Object.defineProperty(process, $, {});",
  "$.prototype.$ = function () {};",
  "Array.prototype[$] = 1;",
  "delete $.prototype.map;",
  "function (",
  "function f($) { return $ }",
  "class $ extends $ {}",
  "class A { #$ = 1 }",
  "({ $ })",
  "`${$}`",
  "${",
  "}",
  "/*",
  "*/ Date.now = 1 /*",
  "// Date.now = 1",
  "<div>{$}</div>",
  "<script>Date.now = () => 1</script>",
  "#!/usr/bin/env bun\\nDate.now = () => 1;",
  "def f($):\\n    return $",
  "SELECT * FROM $ WHERE a = '$'",
  '{ "a": $ }',
  "a ? . b",
  "await $",
  "yield $",
  "new.target",
  "import.meta.$",
  "import.meta.require($)",
  "new Worker($)",
  "new Worker(new URL($, import.meta.url))",
  "Bun.plugin({ setup(build) { build.module($, () => ({})) } })",
  "\\u{1F600} = 1",
  "\\0",
  "'use strict'; with ($) {}",
  "0b2 08 1__0 1n.5",
  "a\\u2028b",
];

/** A scene whose member the compiled run refuses to replace, saying so, is left out of the comparison; the others are compared. */
export function meant(plain: string, compiled: string): string | undefined {
  const refused = new Set(Array.from(compiled.matchAll(/^(\d+) refused: /gm), found => found[1]));
  if (!refused.size) return undefined;
  const others = (text: string) => text.split("\n").filter(line => !refused.has(/^(\d+) /.exec(line)?.[1] ?? "")).join("\n"); // prettier-ignore
  return others(plain) === others(compiled) ? "the run says that a test can't replace this member" : undefined;
}

const keyOf = (name: string) => (name.startsWith("@@") ? "Symbol." + name.slice(2) : JSON.stringify(name));
const memberOf = (name: string) => (name.startsWith("@@") ? `[Symbol.${name.slice(2)}]` : "." + name);

export function generate(random: Random): { text: string; files?: Record<string, string> } {
  const imports = new Set(["test"]);
  const modules = new Map<string, string>();
  const scenes: string[] = [];
  const elsewhere: string[] = [];
  let usesHelperFile = false;
  // Some faults show only where nothing else in the run is replaced.
  const count = random.pick([1, 1, 1, 2, 3, 4, 6]);
  for (let scene = 0; scene < count; scene++) {
    if (random.chance(0.15)) {
      const parts = Array.from({ length: random.between(1, 4) }, () => random.pick(texts));
      const isTemplate = random.chance(0.6);
      const body = parts.join(random.pick(["\\n", " ", ";", " ; "]));
      const filled = isTemplate
        ? "`" + body.replaceAll("`", "\\`").replaceAll("${", "\\${").replaceAll("$", () => "${" + random.pick(["part", "1", '"x"', "part + 1", "[part]"]) + "}") + "`" // prettier-ignore
        : JSON.stringify(body.replaceAll("\\n", "\n").replaceAll("$", "x")).replaceAll("\\\\", "\\");
      scenes.push(
        `{\n  const part = "p${scene}";\n  const text = ${filled};\n  say("${scene} a text of " + text.length + " " + typeof part);\n}`,
      );
      continue;
    }
    const aimed = random.pick(targets);
    const isName = !aimed.name.startsWith("@@");
    const isGlobal = !aimed.module;
    const inTest = random.chance(0.4);
    const way = random.pick(
      ways.filter(
        each =>
          (isName || !each.isOnlyForNames) &&
          (isGlobal || !each.isOnlyForGlobals) &&
          !(aimed.isOnlyUsedReplaced && each.uncoversWhatIsAbove),
      ),
    );
    for (const name of way.imports ?? []) imports.add(name);
    if (aimed.module) modules.set(aimed.holder, aimed.module);
    usesHelperFile ||= !!way.usesHelperFile;
    const fill = (text: string) =>
      text
        .replaceAll("HD", aimed.holder + memberOf(aimed.name))
        .replaceAll("@D", scene + memberOf(aimed.name))
        .replaceAll("@", String(scene))
        .replace(/\bH\b/g, aimed.holder)
        .replace(/\bK\b/g, keyOf(aimed.name))
        .replace(/\bF\b/g, `function (...given) {\n    calls${scene}++;\n    ${aimed.isOnlyUsedReplaced || aimed.kind === "constant" ? "" : `const answer = applyReal(real${scene}, this, given);\n    `}return ${aimed.isOnlyUsedReplaced ? "undefined" : changes[aimed.kind]};\n  }`); // prettier-ignore
    const used = random.pick(aimed.uses);
    const isElsewhere = random.chance(0.5);
    const use = `use${scene}`;
    const declared = `function ${use}() {\n  return ${used};\n}`;
    if (isElsewhere) elsewhere.push("export " + declared);
    const steps = [
      `const was${scene} = Object.getOwnPropertyDescriptor(${aimed.holder}, ${keyOf(aimed.name)});`,
      `const real${scene} = ${aimed.holder}${memberOf(aimed.name)};`,
      `let calls${scene} = 0;`,
      ...(aimed.isOnlyUsedReplaced ? [] : [`attempt("${scene} before", ${use});`]),
      "try {",
      fill(way.replace),
      `attempt("${scene} replaced", ${use});`,
      ...(random.chance(0.5) ? [`attempt("${scene} replaced, written here", () => ${used});`] : []),
      ...(random.chance(0.3) ? [`attempt("${scene} replaced, again", ${use});`] : []),
      way.restore && random.chance(0.7)
        ? fill(way.restore)
        : `if (was${scene}) Object.defineProperty(${aimed.holder}, ${keyOf(aimed.name)}, was${scene});\n  else delete ${aimed.holder}${memberOf(aimed.name)};`,
      `say("${scene} calls " + (calls${scene} > 0 ? "some" : "none"));`,
      ...(aimed.isOnlyUsedReplaced ? [] : [`attempt("${scene} put back", ${use});`]),
      `} catch (error) {\n    if (!isRefusal(error)) throw error;\n    say("${scene} refused: ${aimed.holder}${memberOf(aimed.name)}");\n  }`,
    ].join("\n  ");
    scenes.push(
      (isElsewhere ? "" : declared + "\n") +
        (inTest ? `test("scene ${scene}", async () => {\n  ${steps}\n});` : `{\n  ${steps}\n}`),
    );
  }
  const shared = `const record = { first: 1, second: "two" };
const list = [1, 2, 3];
// Put together here: the transpiler answers a call on a text that it knows.
const word = ["wo", "rd"].join("");
const table = new Map([[0, 10], [1, 11]]);
const group = new Set([1, 2]);
function plus(a, b) {
  return a + b;
}
function sumOf(each) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += each(i);
  return sum;
}`;
  const loads = [...modules].map(([name, from]) => `import ${name} from ${JSON.stringify(from)};`).join("\n");
  const names = elsewhere.map(text => /function (\w+)/.exec(text)![1]);
  const files: Record<string, string> = {};
  if (elsewhere.length) files["source.js"] = `${loads}\n${shared}\n${elsewhere.join("\n")}\n`;
  if (usesHelperFile) files["helper.js"] = "export function putElsewhere(on, name, value) {\n  on[name] = value;\n}\n";
  const text = `import { ${[...imports].sort().join(", ")} } from "bun:test";
${loads}
${names.length ? `import { ${names.join(", ")} } from "./source.js";\n` : ""}${usesHelperFile ? 'import { putElsewhere } from "./helper.js";\n' : ""}// Taken before anything is replaced: what prints and what calls the real one does not go through a fake.
const say = console.log.bind(console);
const applyReal = Reflect.apply;
const keysOf = Object.keys;
const isList = Array.isArray;
function show(value, depth = 0) {
  if (typeof value === "string") return '"' + value + '"';
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  if (typeof value !== "object" || value === null) return "" + value;
  if (depth > 2) return "..";
  let text = "";
  if (isList(value)) {
    for (let i = 0; i < value.length; i++) text += (i ? "," : "") + show(value[i], depth + 1);
    return "[" + text + "]";
  }
  const keys = keysOf(value);
  for (let i = 0; i < keys.length; i++) text += (i ? "," : "") + keys[i] + ":" + show(value[keys[i]], depth + 1);
  return "{" + text + "}";
}
function attempt(label, ask) {
  let text;
  try {
    text = show(ask());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  say(label + ": " + text);
}
// A compiled test run says of some members that a test can't replace them.
const includes = String.prototype.includes;
function isRefusal(error) {
  return typeof error?.message === "string" && applyReal(includes, error.message, ["read-only in compiled code"]);
}
function andMore(from) {
  const more = [];
  for (let i = 0; i < from.length; i++) more[i] = from[i];
  more[more.length] = "more";
  return more;
}
function made(name) {
  let text = "";
  for (let i = 0; i < name.length; i++) text += name[i];
  return text;
}
function put(on, name, value) {
  on[name] = value;
}
${shared}
${scenes.join("\n")}
`;
  return Object.keys(files).length ? { text, files } : { text };
}
