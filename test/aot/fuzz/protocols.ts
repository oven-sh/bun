// Writes small programs in which a built-in or an operator runs the program's own code on an operand.
// Each program is one point of: use x holder x escape x mix x behavior. Its name spells the point, so `--name` writes it again.
//
//   bun test/aot/fuzz/protocols.ts --out <folder> [--count 2000] [--seed 1] [--flavor shell|bun] [--only <regex>]
//   bun test/aot/fuzz/protocols.ts --name <point> [--flavor shell|bun]     prints one program
//   bun test/aot/fuzz/protocols.ts --list                                  prints the size of each dimension
//
// A program prints what it sees. It is right when the compiled program prints what the interpreter prints.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Random } from "./random";

type Flavor = "shell" | "bun";
type Kind = "method" | "getter" | "callable";

interface Use {
  name: string;
  text: string;
  isAsync?: boolean;
  needsHost?: boolean;
}

interface Family {
  name: string;
  kind: Kind;
  key: string;
  parameters: string;
  deliver: (result: string) => string;
  results: string[];
  uses: Use[];
  membersStoredAfter?: string[];
  modifier?: "*" | "async" | "async*";
  beforeEachRun?: string;
  helpers?: string;
  ownBehaviors?: Record<string, string>;
}

interface Code {
  key: string;
  keyExpression: string;
  member: (base: string) => string;
  parameters: string;
  body: string;
  decoyBody: string;
  methodPrefix: string;
  functionKeyword: string;
}

const returns = (result: string) => `return ${result};`;
const use = (name: string, text: string, more: Partial<Use> = {}): Use => ({ name, text, ...more });
const later = (name: string, text: string, more: Partial<Use> = {}): Use => ({ name, text, isAsync: true, ...more });

const iterationUses = (wrap: (x: string) => string): Use[] => [
  use("for-of", `collectLoop(${wrap("x")})`),
  use("spread", `[...${wrap("x")}]`),
  use("pattern", `firstTwo(${wrap("x")})`),
  use("pattern-rest", `restOf(${wrap("x")})`),
  use("call-spread", `collect(...${wrap("x")})`),
  use("new-spread", `new Array(...${wrap("x")}, 5)`),
  use("set", `[...new Set(${wrap("x")})]`),
  use("array-from", `Array.from(${wrap("x")})`),
  use("array-from-mapped", `Array.from(${wrap("x")}, v => [v])`),
  use("yield-star", `[...delegate(${wrap("x")})]`),
  use("math-max", `Math.max(...${wrap("x")})`),
  use("typed-array", `[...new Float64Array(${wrap("x")})]`),
  use("iterator-from", `Iterator.from(${wrap("x")}).toArray()`),
  later("promise-all", `await Promise.all(${wrap("x")})`),
  later("for-await", `await collectAsync(${wrap("x")})`),
];

const iterationHelpers = `
function collect(...list) { return list; }
function collectLoop(it) { const list = []; for (const v of it) list.push(v); return list; }
function firstTwo(it) { const [a, b] = it; return [a, b]; }
function restOf(it) { const [a, ...rest] = it; return [a, rest]; }
function* delegate(it) { const last = yield* it; yield last; }
async function collectAsync(it) { const list = []; for await (const v of it) list.push(v); return list; }
function iterableOf(iterator) { return { [Symbol.iterator]() { return iterator; } }; }
`;

const twoSteps = (result: string) =>
  `let i = 0; return { next() { return i++ < 2 ? { done: false, value: ${result} } : { done: true, value: undefined }; } };`;

const families: Family[] = [
  {
    name: "valueOf",
    kind: "method",
    key: "valueOf",
    parameters: "",
    deliver: returns,
    results: ["5", '"five"', "5n", "true", "null", "undefined", "{}", "Symbol.iterator", "2.5", "-0", "NaN"],
    helpers: `
function increment(y) { y++; return y; }
function decrement(y) { return --y; }
function addTo(y) { let t = 1; t += y; return t; }
function multiplyInto(y) { let t = 2; t *= y; return t; }
`,
    uses: [
      use("add", "x + 1"),
      use("add-left", "1 + x"),
      use("add-string", '"a" + x'),
      use("add-self", "x + x"),
      use("add-bigint", "x + 1n"),
      use("subtract", "x - 1"),
      use("multiply", "x * 2"),
      use("multiply-bigint", "x * 2n"),
      use("divide", "x / 2"),
      use("remainder", "x % 3"),
      use("power", "x ** 2"),
      use("plus", "+x"),
      use("negate", "-x"),
      use("bit-not", "~x"),
      use("increment", "increment(x)"),
      use("decrement", "decrement(x)"),
      use("add-assign", "addTo(x)"),
      use("multiply-assign", "multiplyInto(x)"),
      use("less", "x < 6"),
      use("less-right", "6 < x"),
      use("greater-equal", "x >= 5"),
      use("less-self", "x < x"),
      use("less-string", 'x < "g"'),
      use("equal", "x == 5"),
      use("equal-right", "5 == x"),
      use("not-equal-string", 'x != "five"'),
      use("equal-bigint", "x == 5n"),
      use("bit-or", "x | 0"),
      use("bit-and", "x & 4"),
      use("bit-xor", "x ^ 1"),
      use("shift-left", "x << 1"),
      use("shift-right", "x >> 1"),
      use("shift-unsigned", "x >>> 1"),
      use("number", "Number(x)"),
      use("math-max", "Math.max(x, 1)"),
      use("math-floor", "Math.floor(x)"),
      use("math-abs", "Math.abs(x)"),
      use("math-pow", "Math.pow(x, 2)"),
      use("math-imul", "Math.imul(x, 3)"),
      use("math-hypot", "Math.hypot(x, 12)"),
      use("is-nan", "isNaN(x)"),
      use("is-finite", "isFinite(x)"),
      use("date", "new Date(x).getTime()"),
      use("char-at", '"abcdefgh".charAt(x)'),
      use("char-code-at", '"abcdefgh".charCodeAt(x)'),
      use("string-slice", '"abcdefgh".slice(x)'),
      use("string-at", '"abcdefgh".at(x)'),
      use("substring", '"abcdefgh".substring(x, 7)'),
      use("repeat", '"ab".repeat(x)'),
      use("pad-start", '"x".padStart(x, "-")'),
      use("array-slice", "[1, 2, 3, 4, 5, 6, 7].slice(x)"),
      use("array-at", "[1, 2, 3, 4, 5, 6, 7].at(x)"),
      use("array-with", "[1, 2, 3, 4, 5, 6, 7].with(x, 0)"),
      use("array-index-of-from", "[1, 2, 3, 4, 5, 6, 1].indexOf(1, x)"),
      use("array-fill", "[1, 2, 3, 4, 5, 6, 7].fill(0, x)"),
      use("array-splice", "[1, 2, 3, 4, 5, 6, 7].splice(x, 1)"),
      use("array-length", "setLength([1, 2, 3, 4, 5, 6, 7], x)"),
      use("from-char-code", "String.fromCharCode(x)"),
      use("to-fixed", "(1.23456789).toFixed(x)"),
      use("to-string-radix", "(255).toString(x)"),
      use("parse-int-radix", 'parseInt("11", x)'),
      use("typed-array-store", "storeElement(new Int32Array(1), x)"),
      use("typed-array-fill", "[...new Int32Array(2).fill(x)]"),
      use("data-view", "new DataView(new ArrayBuffer(16)).getInt8(x)"),
      use("array-buffer", "new ArrayBuffer(x).byteLength"),
      use("bigint-as-int", "BigInt.asIntN(x, 255n)"),
      use("atomics", "Atomics.add(new Int32Array(1), 0, x)"),
      use("subarray", "new Uint8Array(8).subarray(x).length"),
      use("date-month", "new Date(2020, x).getMonth()"),
      use("console-number", '(console.log("%d", x), 1)', { needsHost: true }),
      use("buffer-from", "Buffer.from(x).length", { needsHost: true }),
      use("buffer-alloc", "Buffer.alloc(x).length", { needsHost: true }),
      use("buffer-to-string", 'Buffer.from("abcdefgh").toString("utf8", x)', { needsHost: true }),
      use("abort-timeout", "AbortSignal.timeout(x).aborted", { needsHost: true }),
      later("sleep", '(await Bun.sleep(x), "slept")', { needsHost: true }),
      later("timeout-delay", 'await new Promise(done => setTimeout(done, x, "fired"))', { needsHost: true }),
    ],
  },
  {
    name: "toString",
    kind: "method",
    key: "toString",
    parameters: "",
    deliver: returns,
    results: ['"label"', "42", "7n", "null", "undefined", "true", "{}", "Symbol.iterator", '"0"'],
    uses: [
      use("template", "`${x}`"),
      use("template-parts", "`a${x}b${x}`"),
      use("string", "String(x)"),
      use("concat-empty", '"" + x'),
      use("key-read", "({ label: 1, 42: 2, 0: 3 })[x]"),
      use("key-store", "storeUnder({}, x)"),
      use("key-in", "x in { label: 1 }"),
      use("key-delete", "deleteUnder({ label: 1, other: 2 }, x)"),
      use("key-computed", "({ [x]: 4 })"),
      use("key-array", "[10, 20, 30][x]"),
      use("key-class", "new (class { [x]() { return 1; } })()"),
      use("symbol", "Symbol(x).description"),
      use("error", "new Error(x).message"),
      use("index-of", '"a label".indexOf(x)'),
      use("includes", '"a label".includes(x)'),
      use("starts-with", '"label a".startsWith(x)'),
      use("split", '"a-label-b".split(x)'),
      use("replace", '"a label".replace(x, "!")'),
      use("replace-with", '"a label".replace("a", x)'),
      use("string-concat", '"x".concat(x)'),
      use("pad-end", '"x".padEnd(8, x)'),
      use("locale-compare", '"label".localeCompare(x)'),
      use("parse-int", "parseInt(x)"),
      use("parse-float", "parseFloat(x)"),
      use("number", "Number(x)"),
      use("multiply", "x * 1"),
      use("join", "[x, x].join(\"-\")"),
      use("join-nested", "[[x], 1].join()"),
      use("array-to-string", "[x].toString()"),
      use("sort-default", '[x, "a", "z"].sort().length'),
      use("regexp", "new RegExp(x).source"),
      use("regexp-test", "/label|42/.test(x)"),
      use("regexp-exec", "/l(a)/.exec(x)"),
      use("has-own", "Object.hasOwn({ label: 1 }, x)"),
      use("has-own-property", "({ label: 1 }).hasOwnProperty(x)"),
      use("reflect-has", "Reflect.has({ label: 1 }, x)"),
      use("reflect-get", "Reflect.get({ label: 1 }, x)"),
      use("define-property", "Object.defineProperty({}, x, { value: 1, enumerable: true })"),
      use("from-entries", "Object.fromEntries([[x, 1]])"),
      use("own-descriptor", "Object.getOwnPropertyDescriptor({ label: 1 }, x)"),
      use("encode", "encodeURIComponent(x)"),
      use("trim-call", "String.prototype.trim.call(x)"),
      use("json-parse", "JSON.parse(x)"),
      use("json-indent", "JSON.stringify([1], null, x)"),
      use("bigint", "BigInt(x)"),
      use("date-parse", "Date.parse(x)"),
      use("object-locale-string", "Object.prototype.toLocaleString.call(x)"),
      use("string-raw", "String.raw({ raw: [x, x] }, 1)"),
      use("is-nan", "isNaN(x)"),
      use("url", 'new URL(x, "http://h/").pathname', { needsHost: true }),
      use("btoa", "btoa(x)", { needsHost: true }),
      use("blob", "new Blob([x]).size", { needsHost: true }),
      use("text-encoder", "new TextEncoder().encode(x).length", { needsHost: true }),
      use("escape-html", "Bun.escapeHTML(x)", { needsHost: true }),
      use("string-width", "Bun.stringWidth(x)", { needsHost: true }),
      use("headers-record", 'new Headers({ a: x }).get("a")', { needsHost: true }),
      use("headers-pairs", 'new Headers([["a", x]]).get("a")', { needsHost: true }),
      use("headers-set", 'setHeader(new Headers(), x)', { needsHost: true }),
      use("search-params", 'new URLSearchParams({ a: x }).toString()', { needsHost: true }),
      use("event-type", "new Event(x).type", { needsHost: true }),
      use("dom-exception", "new DOMException(x).message", { needsHost: true }),
      use("console-string", '(console.log("%s", x), 1)', { needsHost: true }),
      use("console-log", "(console.log(x), 1)", { needsHost: true }),
      use("inspect", "typeof Bun.inspect(x)", { needsHost: true }),
      use("request-method", 'new Request("http://h/", { method: "POST", body: x }).method', { needsHost: true }),
      later("response-text", "await new Response(x).text()", { needsHost: true }),
    ],
    helpers: `
function setHeader(headers, value) { headers.set("a", value); return headers.get("a"); }
function storeUnder(t, k) { t[k] = 3; return t; }
function deleteUnder(t, k) { delete t[k]; return t; }
`,
  },
  {
    name: "toPrimitive",
    kind: "method",
    key: "[Symbol.toPrimitive]",
    parameters: "hint",
    deliver: returns,
    results: ["hint", "3", '"s"', "1n", "undefined", "null", "{}", "hint.length", 'hint === "number" ? 3 : "t"'],
    uses: [
      use("add", "x + 1"),
      use("add-self", "x + x"),
      use("template", "`${x}`"),
      use("plus", "+x"),
      use("negate", "-x"),
      use("multiply", "x * 2"),
      use("less", "x < 1"),
      use("equal", 'x == "default"'),
      use("key-read", "({ string: 6, 3: 7, s: 8 })[x]"),
      use("key-in", "x in { string: 6 }"),
      use("date", "new Date(x).getTime()"),
      use("string", "String(x)"),
      use("number", "Number(x)"),
      use("join", "[x].join()"),
      use("bigint", "BigInt(x)"),
      use("bit-or", "x | 0"),
      use("math-max", "Math.max(x, 1)"),
      use("index-of", '"a string".indexOf(x)'),
      use("date-to-json", "Date.prototype.toJSON.call(x)"),
      use("symbol", "Symbol(x).description"),
    ],
  },
  {
    name: "toJSON",
    kind: "method",
    key: "toJSON",
    parameters: "key",
    deliver: returns,
    results: ["3", '"s"', "{ a: 1 }", "[key]", "undefined", "key", "typeof key", "5n", "{ toJSON() { state.n++; return 1; } }", "{ b: { toJSON() { state.n++; return 2; } } }"],
    uses: [
      use("stringify", "JSON.stringify(x)"),
      use("nested", "JSON.stringify({ a: x })"),
      use("array", "JSON.stringify([x, x])"),
      use("deep", "JSON.stringify({ a: { b: [x] } })"),
      use("indent", "JSON.stringify({ a: x }, null, 2)"),
      use("replacer", "JSON.stringify({ a: x }, (k, v) => v)"),
      use("allow-list", 'JSON.stringify({ a: x, b: x }, ["a"])'),
      use("map-value", "JSON.stringify([...new Map([[1, x]])])"),
      use("console-json", '(console.log("%j", x), 1)', { needsHost: true }),
      later("response-json", "await Response.json(x).text()", { needsHost: true }),
      later("response-json-nested", "await Response.json({ a: [x] }).text()", { needsHost: true }),
    ],
  },
  {
    name: "then",
    kind: "method",
    key: "then",
    parameters: "resolve, reject",
    deliver: result => `resolve(${result});`,
    results: ["9", '"s"', "{ then(inner) { state.n++; inner(8); } }", "undefined", "[1]", "Promise.resolve(7)", "{ a: 1 }"],
    ownBehaviors: {
      rejects: "reject(new Boom(3)); return;",
      "rejects-text": 'reject("no"); return;',
      "resolves-twice": 'resolve("first");',
      "throws-after-resolve": 'resolve("first"); throw new Boom(4);',
    },
    uses: [
      later("await", "await x"),
      later("resolve", "await Promise.resolve(x)"),
      later("async-return", "await (async () => x)()"),
      later("then-result", "await Promise.resolve(1).then(() => x)"),
      later("executor", "await new Promise(r => r(x))"),
      later("all", "await Promise.all([x, 1])"),
      later("race", "await Promise.race([x])"),
      later("any", "await Promise.any([x])"),
      later("all-settled", "await Promise.allSettled([x])"),
      later("for-await", "await collectAsync([x])"),
      later("async-generator-yield", "await collectAsync(yields(x))"),
      later("async-generator-return", "(await returnsFromGenerator(x).next()).value"),
      later("finally-result", "await Promise.resolve(1).finally(() => x)"),
      later("catch-call", "await Promise.prototype.catch.call(x, e => [e])"),
      later("with-resolvers", "await settle(x)"),
      later("array-from-async", "await Array.fromAsync([x])"),
    ],
    helpers: `
async function collectAsync(it) { const list = []; for await (const v of it) list.push(v); return list; }
async function* yields(v) { yield v; }
async function* returnsFromGenerator(v) { return v; }
function settle(v) { const { promise, resolve } = Promise.withResolvers(); resolve(v); return promise; }
`,
  },
  {
    name: "iterator",
    kind: "method",
    key: "[Symbol.iterator]",
    parameters: "",
    deliver: twoSteps,
    results: ["1", '"s"', "{ a: 1 }", "[i, 2]", "undefined", "i", "2.5"],
    helpers: iterationHelpers,
    uses: [
      ...iterationUses(x => x),
      use("map", "[...new Map(pairsOf(x))]"),
      use("from-entries", "Object.fromEntries(pairsOf(x))"),
      use("group-by", "Object.groupBy(x, v => typeof v)"),
      use("nested-pattern", "nestedPattern([x])"),
      use("weak-set", "tryWeakSet(x)"),
      use("concat", "[0].concat(x).length"),
      use("flat", "[[x]].flat(2).length"),
      use("blob", "new Blob(x).size", { needsHost: true }),
      later("stream-from", "await Bun.readableStreamToArray(ReadableStream.from(x))", { needsHost: true }),
    ],
  },
  {
    name: "iterator-generator",
    kind: "method",
    key: "[Symbol.iterator]",
    parameters: "",
    modifier: "*",
    deliver: result => `yield ${result}; yield ${result}; return "last";`,
    results: ["1", '"s"', "{ a: 1 }", "[1, 2]", "undefined", "calls", "2.5"],
    helpers: iterationHelpers,
    uses: iterationUses(x => x),
  },
  {
    name: "asyncIterator-generator",
    kind: "method",
    key: "[Symbol.asyncIterator]",
    parameters: "",
    modifier: "async*",
    deliver: result => `yield ${result}; yield ${result};`,
    results: ["1", '"s"', "Promise.resolve(3)", "{ then(r) { state.n++; r(2); } }", "undefined"],
    helpers: iterationHelpers + `async function* delegateAsync(it) { yield* it; }\n`,
    uses: [
      later("for-await", "await collectAsync(x)"),
      later("yield-star", "await collectAsync(delegateAsync(x))"),
      later("array-from-async", "await Array.fromAsync(x)"),
    ],
  },
  {
    name: "then-async",
    kind: "method",
    key: "then",
    parameters: "resolve, reject",
    modifier: "async",
    deliver: result => `resolve(${result});`,
    results: ["9", '"s"', "undefined", "[1]"],
    uses: [later("await", "await x"), later("resolve", "await Promise.resolve(x)"), later("async-return", "await (async () => x)()"), later("all", "await Promise.all([x, 1])")],
  },
  {
    name: "next",
    kind: "method",
    key: "next",
    parameters: "sent",
    deliver: result => `return ++count > 2 ? { done: true, value: undefined } : { done: false, value: ${result} };`,
    results: ["1", '"s"', "{ a: 1 }", "count", "undefined", "sent", "[count]"],
    beforeEachRun: "count = 0;",
    helpers: iterationHelpers,
    uses: iterationUses(x => `iterableOf(${x})`),
  },
  {
    name: "next-result",
    kind: "method",
    key: "next",
    parameters: "",
    deliver: returns,
    results: [
      "{ done: true, value: 4 }",
      "5",
      "undefined",
      "null",
      "{ get done() { state.n++; return true; }, value: 1 }",
      '{ done: ++count > 1, get value() { state.n++; return "got"; } }',
      '{ done: ++count > 1 ? "yes" : 0, value: count }',
      "Object.create({ done: ++count > 1, value: count })",
    ],
    beforeEachRun: "count = 0;",
    helpers: iterationHelpers,
    uses: iterationUses(x => `iterableOf(${x})`),
  },
  {
    name: "return",
    kind: "method",
    key: "return",
    parameters: "value",
    deliver: returns,
    results: ["{}", "{ done: true, value: 2 }", "5", "undefined", "null", "{ value }"],
    membersStoredAfter: ["o.next = function () { return { done: false, value: 1 }; };"],
    helpers:
      iterationHelpers +
      `
function breakOut(it) { let seen; for (const v of it) { seen = v; break; } return seen; }
function returnOut(it) { for (const v of it) return v; }
function throwOut(it) { for (const v of it) throw new Boom(v); }
function continueOuter(it) { let n = 0; outer: for (let i = 0; i < 2; i++) { for (const v of it) { n += v; continue outer; } } return n; }
function firstOnly(it) { const [a] = it; return a; }
function emptyPattern(it) { const [] = it; return "empty"; }
function closeDelegate(it) { const g = delegate(it); g.next(); return g.return(6); }
`,
    uses: [
      use("break", "breakOut(iterableOf(x))"),
      use("return", "returnOut(iterableOf(x))"),
      use("throw", "throwOut(iterableOf(x))"),
      use("continue-outer", "continueOuter(iterableOf(x))"),
      use("pattern", "firstOnly(iterableOf(x))"),
      use("empty-pattern", "emptyPattern(iterableOf(x))"),
      use("yield-star-return", "closeDelegate(iterableOf(x))"),
      use("map-bad-entry", "new Map(iterableOf(x))"),
      use("iterator-take", "Iterator.from(iterableOf(x)).take(1).toArray()"),
      later("promise-all-bad-resolve", "await Promise.all.call(function (f) { f(() => {}, () => {}); }, iterableOf(x))"),
    ],
  },
  {
    name: "throw",
    kind: "method",
    key: "throw",
    parameters: "error",
    deliver: result => `return { done: true, value: ${result} };`,
    results: ["1", "error", '"s"', "error.code"],
    membersStoredAfter: ["o.next = function () { return { done: false, value: 1 }; };"],
    helpers: iterationHelpers + `function throwInto(it) { const g = delegate(it); g.next(); return g.throw(new Boom(1)); }\n`,
    uses: [use("yield-star-throw", "throwInto(iterableOf(x))")],
  },
  {
    name: "asyncIterator",
    kind: "method",
    key: "[Symbol.asyncIterator]",
    parameters: "",
    deliver: twoSteps,
    results: ["1", '"s"', "Promise.resolve(3)", "{ then(r) { state.n++; r(2); } }", "undefined"],
    helpers: iterationHelpers + `async function* delegateAsync(it) { yield* it; }\n`,
    uses: [
      later("for-await", "await collectAsync(x)"),
      later("yield-star", "await collectAsync(delegateAsync(x))"),
      later("array-from-async", "await Array.fromAsync(x)"),
    ],
  },
  {
    name: "hasInstance",
    kind: "method",
    key: "[Symbol.hasInstance]",
    parameters: "v",
    deliver: returns,
    results: ["v === 1", "1", '""', "{}", "undefined", "v"],
    uses: [
      use("instanceof", "1 instanceof x"),
      use("instanceof-pair", "[1 instanceof x, 0 instanceof x]"),
      use("instanceof-object", "state instanceof x"),
      use("instanceof-branch", '(1 instanceof x) ? "yes" : "no"'),
    ],
  },
  ...(["match", "matchAll", "replace", "search", "split"] as const).map(
    (name): Family => ({
      name,
      kind: "method",
      key: `[Symbol.${name}]`,
      parameters: "text, extra",
      deliver: returns,
      results: ['"R:" + text', "5", "[text, extra]", "null", "undefined", "{ a: text }"],
      uses: [
        use("call", name === "replace" ? '"abc".replace(x, "y")' : `"abc".${name}(x)`),
        ...(name === "replace" ? [use("replace-all", '"abc".replaceAll(x, "y")')] : []),
        ...(name === "split" ? [use("split-limit", '"abc".split(x, 2)')] : []),
      ],
    }),
  ),
  {
    name: "exec",
    kind: "method",
    key: "exec",
    parameters: "text",
    deliver: returns,
    results: ["null", "[text]", "5", "undefined", "{ index: 1, 0: \"b\", length: 1 }"],
    membersStoredAfter: ['o.flags = "";', "o.lastIndex = 0;"],
    uses: [
      use("test", 'RegExp.prototype.test.call(x, "abc")'),
      use("match", 'RegExp.prototype[Symbol.match].call(x, "abc")'),
      use("replace", 'RegExp.prototype[Symbol.replace].call(x, "abc", "y")'),
      use("search", 'RegExp.prototype[Symbol.search].call(x, "abc")'),
    ],
  },
  {
    name: "join",
    kind: "method",
    key: "join",
    parameters: "",
    deliver: returns,
    results: ['"joined"', "5", "{}", "undefined"],
    uses: [use("array-to-string", "Array.prototype.toString.call(x)")],
  },
  {
    name: "toISOString",
    kind: "method",
    key: "toISOString",
    parameters: "",
    deliver: returns,
    results: ['"iso"', "5", "{ a: 1 }"],
    uses: [use("date-to-json", "Date.prototype.toJSON.call(x)")],
  },
  {
    name: "toLocaleString",
    kind: "method",
    key: "toLocaleString",
    parameters: "",
    deliver: returns,
    results: ['"local"', "5", "null", "{ toString() { state.n++; return \"deep\"; } }"],
    uses: [use("array", "[x, 1].toLocaleString()")],
  },
  {
    name: "dispose",
    kind: "method",
    key: "[Symbol.dispose]",
    parameters: "",
    deliver: returns,
    results: ["1", "undefined"],
    helpers: `
function useOnce(resource) { { using held = resource; log += "body;"; } return "left"; }
function useAndThrow(resource) { using held = resource; throw new Boom(2); }
function useStack(resource) { const stack = new DisposableStack(); stack.use(resource); stack.dispose(); return stack.disposed; }
`,
    uses: [use("using", "useOnce(x)"), use("using-throw", "useAndThrow(x)"), use("stack", "useStack(x)")],
  },
  {
    name: "asyncDispose",
    kind: "method",
    key: "[Symbol.asyncDispose]",
    parameters: "",
    deliver: returns,
    results: ["1", "Promise.resolve(2)", "{ then(r) { state.n++; r(); } }"],
    helpers: `async function useOnce(resource) { { await using held = resource; log += "body;"; } return "left"; }\n`,
    uses: [later("await-using", "await useOnce(x)")],
  },
  ...(
    [
      ["get", "target, key, receiver", ["42", "key", "target", "undefined"], "new Proxy({}, x).p"],
      ["has", "target, key", ["true", "0", '"yes"'], '"p" in new Proxy({}, x)'],
      ["set", "target, key, value", ["true", "1"], "storeInto(new Proxy({}, x))"],
      ["deleteProperty", "target, key", ["true", "1"], "delete new Proxy({}, x).p"],
      ["ownKeys", "target", ['["a", "b"]', "[]", "5", '[Symbol.iterator, "z"]'], "Reflect.ownKeys(new Proxy({}, x))"],
      ["getOwnPropertyDescriptor", "target, key", ["undefined", "{ value: 1, configurable: true }", "5"], 'Object.getOwnPropertyDescriptor(new Proxy({}, x), "p")'],
      ["defineProperty", "target, key, descriptor", ["true", "1"], 'Reflect.defineProperty(new Proxy({}, x), "p", { value: 1 })'],
      ["getPrototypeOf", "target", ["Array.prototype", "null", "5"], "Object.getPrototypeOf(new Proxy({}, x)) === Array.prototype"],
      ["setPrototypeOf", "target, prototype", ["true", "1"], "Reflect.setPrototypeOf(new Proxy({}, x), null)"],
      ["isExtensible", "target", ["true", "1"], "Object.isExtensible(new Proxy({}, x))"],
      ["preventExtensions", "target", ["false", "0"], "Reflect.preventExtensions(new Proxy({}, x))"],
      ["apply", "target, self, list", ["43", "list", "self"], "new Proxy(function () {}, x)(1, 2)"],
      ["construct", "target, list, newTarget", ["{ made: 1 }", "list", "5"], "new (new Proxy(function () {}, x))(1)"],
    ] as const
  ).map(
    ([key, parameters, results, text]): Family => ({
      name: `trap-${key}`,
      kind: "method",
      key,
      parameters,
      deliver: returns,
      results: [...results],
      helpers: `function storeInto(t) { t.p = 1; return "stored"; }\n`,
      uses: [
        use("direct", text),
        ...(key === "get"
          ? [
              use("to-primitive", "`${new Proxy({}, x)}`"),
              use("spread", "({ ...new Proxy({ p: 1 }, x) })"),
              use("inherited", "Object.create(new Proxy({}, x)).p"),
              use("json", "JSON.stringify(new Proxy({ p: 1 }, x))"),
              later("await", "await new Proxy({}, x)"),
            ]
          : []),
        ...(key === "ownKeys" ? [use("keys", "Object.keys(new Proxy({}, x))"), use("for-in", "keysIn(new Proxy({}, x))"), use("spread", "({ ...new Proxy({}, x) })")] : []),
        ...(key === "has" ? [use("inherited", '"p" in Object.create(new Proxy({}, x))')] : []),
        ...(key === "getPrototypeOf" ? [use("instanceof", "new Proxy({}, x) instanceof Array")] : []),
      ],
    }),
  ),
  ...(
    [
      ["value", ["45", '"s"', "undefined", "{ a: 1 }"], 'Object.defineProperty({}, "p", x).p'],
      ["get", ["function () { state.n++; return 44; }", "undefined", "5"], 'Object.defineProperty({}, "p", x).p'],
      ["set", ["function (v) { state.n = v; }", "undefined", "5"], 'storeInto(Object.defineProperty({}, "p", x))'],
      ["enumerable", ["true", "0", '"yes"'], 'Object.keys(Object.defineProperty({}, "p", x))'],
      ["writable", ["true", "0"], 'storeLoosely(Object.defineProperty({}, "p", x))'],
      ["configurable", ["true", "0"], 'Reflect.deleteProperty(Object.defineProperty({}, "p", x), "p")'],
    ] as const
  ).map(
    ([key, results, text]): Family => ({
      name: `descriptor-${key}`,
      kind: "getter",
      key,
      parameters: "",
      deliver: returns,
      results: [...results],
      helpers: `
function storeInto(t) { t.p = 6; return "stored"; }
function storeLoosely(t) { Reflect.set(t, "p", 5); return t.p; }
`,
      uses: [
        use("define", text),
        use("create", text.replace('Object.defineProperty({}, "p", x)', "Object.create(null, { p: x })")),
        use("define-properties", text.replace('Object.defineProperty({}, "p", x)', "Object.defineProperties({}, { p: x })")),
      ],
    }),
  ),
  {
    name: "own-value",
    kind: "getter",
    key: "a",
    parameters: "",
    deliver: returns,
    results: ["1", '"s"', "{ b: 2 }", "undefined", "function () { return 1; }", "5n", "[1]"],
    helpers: `
function keysAndValuesIn(t) { const list = []; for (const k in t) list.push(k, t[k]); return list; }
function pick({ a }) { return a; }
function pickDefault({ a = "default" }) { return a; }
function pickRest({ n, ...rest }) { return rest; }
`,
    uses: [
      use("assign", "Object.assign({}, x)"),
      use("assign-second", "Object.assign({}, { a: 0 }, x)"),
      use("spread", "({ ...x })"),
      use("spread-after", "({ a: 0, ...x })"),
      use("values", "Object.values(x)"),
      use("entries", "Object.entries(x)"),
      use("stringify", "JSON.stringify(x)"),
      use("stringify-nested", "JSON.stringify([{ inner: x }])"),
      use("for-in", "keysAndValuesIn(x)"),
      use("pattern", "pick(x)"),
      use("pattern-default", "pickDefault(x)"),
      use("pattern-rest", "pickRest(x)"),
      use("reflect-get", 'Reflect.get(x, "a")'),
      use("reflect-get-receiver", 'Reflect.get(x, "a", state)'),
      use("read", "x.a"),
      use("read-twice", "[x.a, x.a]"),
      use("read-by-key", 'x["a".trim()]'),
      use("optional", "x?.a"),
      use("in", '"a" in x'),
      use("define-properties", "Object.defineProperties({}, { p: { value: 1, enumerable: true, ...x } })"),
      use("clone", "structuredClone(x)", { needsHost: true }),
      use("inspect", "Bun.inspect(x).length > 0", { needsHost: true }),
      use("deep-equals", "Bun.deepEquals(x, { n: 0, a: 1 })", { needsHost: true }),
      use("search-params", "new URLSearchParams(x).toString()", { needsHost: true }),
      use("headers", 'new Headers(x).get("a")', { needsHost: true }),
      use("console-log", "(console.log(x), 1)", { needsHost: true }),
      use("console-table", "(console.table([x]), 1)", { needsHost: true }),
      later("response-json", "await Response.json(x).text()", { needsHost: true }),
    ],
  },
  {
    name: "length",
    kind: "getter",
    key: "length",
    parameters: "",
    deliver: returns,
    results: ["1", '"1"', "{ valueOf() { state.n++; return 1; } }", "1.5", "undefined", "-1", "2"],
    membersStoredAfter: ["o[0] = 65;"],
    helpers: `function collect(...list) { return list; }\n`,
    uses: [
      use("array-from", "Array.from(x)"),
      use("slice", "Array.prototype.slice.call(x)"),
      use("map", "Array.prototype.map.call(x, v => v)"),
      use("join", "Array.prototype.join.call(x)"),
      use("index-of", "Array.prototype.indexOf.call(x, 65)"),
      use("includes", "Array.prototype.includes.call(x, 65)"),
      use("at", "Array.prototype.at.call(x, 0)"),
      use("reduce", "Array.prototype.reduce.call(x, (a, v) => a + v, 0)"),
      use("for-each", "eachOf(x)"),
      use("apply", "collect.apply(null, x)"),
      use("reflect-apply", "Reflect.apply(collect, null, x)"),
      use("reflect-construct", "Reflect.construct(Array, x)"),
      use("from-char-code", "String.fromCharCode.apply(null, x)"),
      use("typed-array", "[...new Uint8Array(x)]"),
      use("typed-array-set", "setFrom(new Uint8Array(2), x)"),
      use("concat-spreadable", "[].concat(Object.assign(x, { [Symbol.isConcatSpreadable]: true }))"),
      use("string-raw", "String.raw({ raw: x })"),
      use("to-sorted", "Array.prototype.toSorted.call(x)"),
      use("bind-length", "boundLength(x)"),
    ],
  },
  {
    name: "element",
    kind: "getter",
    key: "0",
    parameters: "",
    deliver: returns,
    results: ["65", '"s"', "{ a: 1 }", "undefined", "[1]"],
    membersStoredAfter: ["o.length = 1;"],
    helpers: `function collect(...list) { return list; }\n`,
    uses: [
      use("array-from", "Array.from(x)"),
      use("slice", "Array.prototype.slice.call(x)"),
      use("join", "Array.prototype.join.call(x)"),
      use("apply", "collect.apply(null, x)"),
      use("reflect-apply", "Reflect.apply(collect, null, x)"),
      use("index-of", "Array.prototype.indexOf.call(x, 65)"),
      use("typed-array", "[...new Uint8Array(x)]"),
      use("read", "x[0]"),
      use("flat", "Array.prototype.flat.call(x)"),
    ],
  },
  {
    name: "isConcatSpreadable",
    kind: "getter",
    key: "[Symbol.isConcatSpreadable]",
    parameters: "",
    deliver: returns,
    results: ["true", "0", "1", "undefined", '"yes"'],
    membersStoredAfter: ["o.length = 1;", "o[0] = 65;"],
    uses: [use("concat", "[0].concat(x)"), use("concat-receiver", "Array.prototype.concat.call(x, 1)")],
  },
  {
    name: "toStringTag",
    kind: "getter",
    key: "[Symbol.toStringTag]",
    parameters: "",
    deliver: returns,
    results: ['"T"', "5", "undefined", "{}"],
    uses: [use("object-to-string", "Object.prototype.toString.call(x)"), use("template", "`${x}`"), use("concat", '"" + x')],
  },
  {
    name: "cause",
    kind: "getter",
    key: "cause",
    parameters: "",
    deliver: returns,
    results: ["46", '"s"', "{ a: 1 }", "undefined"],
    uses: [
      use("error", 'new Error("m", x).cause'),
      use("type-error", 'new TypeError("m", x).cause'),
      use("aggregate", 'new AggregateError([], "m", x).cause'),
      use("call", 'Error("m", x).cause'),
    ],
  },
  ...(["message", "name"] as const).map(
    (key): Family => ({
      name: `error-${key}`,
      kind: "getter",
      key,
      parameters: "",
      deliver: returns,
      results: ['"M"', "5", "undefined", "{ toString() { state.n++; return \"deep\"; } }"],
      uses: [use("to-string", "Error.prototype.toString.call(x)")],
    }),
  ),
  ...(["source", "flags"] as const).map(
    (key): Family => ({
      name: `regexp-${key}`,
      kind: "getter",
      key,
      parameters: "",
      deliver: returns,
      results: ['"g"', "5", "undefined", "{ toString() { state.n++; return \"i\"; } }"],
      uses: [use("to-string", "RegExp.prototype.toString.call(x)")],
    }),
  ),
  {
    name: "species",
    kind: "getter",
    key: "[Symbol.species]",
    parameters: "",
    deliver: returns,
    results: [
      "Array",
      "undefined",
      "null",
      "function (length) { state.n++; return { made: length }; }",
      "class extends Array {}",
      "5",
      "function (length) { state.n++; return new Array(length); }",
      "Object",
    ],
    helpers: `function arrayOf(constructor) { const list = [1, 2, 3]; list.constructor = constructor; return list; }\n`,
    uses: [
      use("map", "arrayOf(x).map(v => v + 1)"),
      use("filter", "arrayOf(x).filter(v => v > 1)"),
      use("slice", "arrayOf(x).slice(1)"),
      use("splice", "arrayOf(x).splice(1, 1)"),
      use("concat", "arrayOf(x).concat([4])"),
      use("flat", "arrayOf(x).flat()"),
      use("flat-map", "arrayOf(x).flatMap(v => [v])"),
    ],
  },
  {
    name: "promise-species",
    kind: "getter",
    key: "[Symbol.species]",
    parameters: "",
    deliver: returns,
    results: [
      "Promise",
      "undefined",
      "class extends Promise {}",
      "function (executor) { state.n++; return new Promise(executor); }",
      "5",
    ],
    helpers: `function promiseOf(constructor) { const promise = Promise.resolve(1); promise.constructor = constructor; return promise; }\n`,
    uses: [
      later("then", "await promiseOf(x).then(v => v + 1)"),
      later("finally", "await promiseOf(x).finally(() => {})"),
      later("catch", "await promiseOf(x).catch(() => {})"),
      later("await", "await promiseOf(x)"),
      later("resolve", "await Promise.resolve(promiseOf(x))"),
    ],
  },
  {
    name: "constructor",
    kind: "getter",
    key: "constructor",
    parameters: "",
    deliver: returns,
    results: ["Object", "undefined", "{ [Symbol.species]: function (n) { state.n++; return [n]; } }", "5", "Array"],
    helpers: `function inheriting(prototype) { const list = [1, 2, 3]; Object.setPrototypeOf(list, prototype); return list; }\n`,
    uses: [
      use("map", "Array.prototype.map.call(inheriting(x), v => v)"),
      use("slice", "Array.prototype.slice.call(inheriting(x), 1)"),
      use("read", "x.constructor"),
    ],
  },
  {
    name: "set-like-size",
    kind: "getter",
    key: "size",
    parameters: "",
    deliver: returns,
    results: ["1", '"1"', "{ valueOf() { state.n++; return 1; } }", "undefined", "NaN"],
    membersStoredAfter: ["o.has = function (v) { return v === 1; };", "o.keys = function () { return [1][Symbol.iterator](); };"],
    uses: [
      use("union", "[...new Set([1, 2]).union(x)]"),
      use("intersection", "[...new Set([1, 2]).intersection(x)]"),
      use("is-subset", "new Set([1]).isSubsetOf(x)"),
    ],
  },
  {
    name: "set-like-has",
    kind: "method",
    key: "has",
    parameters: "v",
    deliver: returns,
    results: ["v === 1", "1", '""', "undefined"],
    membersStoredAfter: ["o.size = 5;", "o.keys = function () { return [1][Symbol.iterator](); };"],
    uses: [
      use("intersection", "[...new Set([1, 2]).intersection(x)]"),
      use("difference", "[...new Set([1, 2]).difference(x)]"),
      use("is-subset", "new Set([1]).isSubsetOf(x)"),
    ],
  },
  {
    name: "set-like-keys",
    kind: "method",
    key: "keys",
    parameters: "",
    deliver: twoSteps,
    results: ["1", '"s"', "i"],
    membersStoredAfter: ["o.size = 1;", "o.has = function (v) { return v === 1; };"],
    uses: [
      use("union", "[...new Set([1, 2]).union(x)]"),
      use("symmetric-difference", "[...new Set([1, 2]).symmetricDifference(x)]"),
      use("is-superset", "new Set([1]).isSupersetOf(x)"),
    ],
  },
  {
    name: "inspect-custom",
    kind: "method",
    key: '[Symbol.for("nodejs.util.inspect.custom")]',
    parameters: "depth, options, inspect",
    deliver: returns,
    results: ['"custom"', "{ a: 1 }", "5", "typeof depth", "typeof inspect"],
    uses: [
      use("inspect", "Bun.inspect(x)", { needsHost: true }),
      use("console-log", "(console.log(x), 1)", { needsHost: true }),
      use("console-nested", "(console.log({ inner: [x] }), 1)", { needsHost: true }),
      use("console-error", "(console.error(x), 1)", { needsHost: true }),
    ],
  },
  {
    name: "handleEvent",
    kind: "method",
    key: "handleEvent",
    parameters: "event",
    deliver: returns,
    results: ["1", "event.type"],
    helpers: `function dispatchTo(listener) { const target = new EventTarget(); target.addEventListener("e", listener); return target.dispatchEvent(new Event("e")); }\n`,
    uses: [use("dispatch", "dispatchTo(x)", { needsHost: true })],
  },
  {
    name: "stream-start",
    kind: "method",
    key: "start",
    parameters: "controller",
    deliver: result => `controller.enqueue(${result}); controller.close();`,
    results: ["1", '"s"', "{ a: 1 }"],
    uses: [later("readable", "await Bun.readableStreamToArray(new ReadableStream(x))", { needsHost: true })],
  },
  {
    name: "stream-pull",
    kind: "method",
    key: "pull",
    parameters: "controller",
    deliver: result => `controller.enqueue(${result}); controller.close();`,
    results: ["1", '"s"', "{ a: 1 }"],
    uses: [later("readable", "await Bun.readableStreamToArray(new ReadableStream(x))", { needsHost: true })],
  },
  ...(
    [
      ["maximumFractionDigits", ["0", "1", '"1"', "{ valueOf() { state.n++; return 1; } }", "undefined"], 'new Intl.NumberFormat("en", x).format(1.25)', false],
      ["maximumFractionDigits", ["0", "1", '"1"', "{ valueOf() { state.n++; return 1; } }", "undefined"], '(1.25).toLocaleString("en", x)', false],
      ["timeZone", ['"UTC"', "undefined", "{ toString() { state.n++; return \"UTC\"; } }"], 'new Intl.DateTimeFormat("en", x).format(0)', false],
      ["timeZone", ['"UTC"', "undefined", "{ toString() { state.n++; return \"UTC\"; } }"], 'new Date(0).toLocaleDateString("en", x)', false],
      ["sensitivity", ['"base"', "undefined"], '"a".localeCompare("A", "en", x)', false],
      ["detail", ["1", '"s"', "{ a: 1 }"], 'new CustomEvent("e", x).detail', true],
      ["bubbles", ["true", "0", '"yes"'], 'new Event("e", x).bubbles', true],
      ["status", ["201", '"202"', "{ valueOf() { state.n++; return 203; } }"], 'new Response("b", x).status', true],
      ["method", ['"POST"', "{ toString() { state.n++; return \"PUT\"; } }"], 'new Request("http://h/", x).method', true],
      ["fatal", ["true", "0"], 'new TextDecoder("utf-8", x).fatal', true],
      ["type", ['"text/plain"', "{ toString() { state.n++; return \"a/b\"; } }"], 'new Blob(["a"], x).type', true],
      ["once", ["true", "0"], "dispatchTwice(x)", true],
      ["depth", ["0", "1", "undefined"], "Bun.inspect({ a: { b: { c: 1 } } }, x)", true],
      ["encoding", ['"utf8"', "undefined"], "typeof require(\"node:fs\").readFileSync(import.meta.path, x)", true],
    ] as const
  ).map(
    ([key, results, text, needsHost], index): Family => ({
      name: `option-${key}-${index}`,
      kind: "getter",
      key,
      parameters: "",
      deliver: returns,
      results: [...results],
      helpers: `function dispatchTwice(options) { let n = 0; const target = new EventTarget(); target.addEventListener("e", () => { n++; }, options); target.dispatchEvent(new Event("e")); target.dispatchEvent(new Event("e")); return n; }\n`,
      uses: [use("read", text, { needsHost })],
    }),
  ),
  {
    name: "comparator",
    kind: "callable",
    key: "",
    parameters: "a, b",
    deliver: returns,
    results: ["a - b", "b - a", '"1"', "undefined", "{ valueOf() { state.n++; return -1; } }", "1n", "NaN", "true"],
    uses: [
      use("sort", "[3, 1, 2].sort(x)"),
      use("to-sorted", "[3, 1, 2].toSorted(x)"),
      use("typed-sort", "[...new Int8Array([3, 1, 2]).sort(x)]"),
      use("sort-strings", '["b", "a"].sort(x)'),
    ],
  },
  {
    name: "element-callback",
    kind: "callable",
    key: "",
    parameters: "v, i, list",
    deliver: returns,
    results: ["v * 2", '"s" + v', "[v]", "undefined", "list", "v > 1", "i", "{ v }", "5n"],
    uses: [
      use("map", "[1, 2, 3].map(x)"),
      use("filter", "[1, 2, 3].filter(x)"),
      use("for-each", "[1, 2, 3].forEach(x)"),
      use("find", "[1, 2, 3].find(x)"),
      use("find-index", "[1, 2, 3].findIndex(x)"),
      use("find-last", "[1, 2, 3].findLast(x)"),
      use("some", "[1, 2, 3].some(x)"),
      use("every", "[1, 2, 3].every(x)"),
      use("flat-map", "[1, 2, 3].flatMap(x)"),
      use("array-from", "Array.from([1, 2, 3], x)"),
      use("array-from-length", "Array.from({ length: 2 }, x)"),
      use("typed-map", "[...new Float64Array([1, 2, 3]).map(x)]"),
      use("set-for-each", "new Set([1, 2]).forEach(x)"),
      use("map-for-each", "new Map([[1, 2]]).forEach(x)"),
      use("group-by", "Object.groupBy([1, 2, 3], x)"),
      use("map-group-by", "[...Map.groupBy([1, 2, 3], x)]"),
      use("iterator-map", "Iterator.from([1, 2, 3]).map(x).toArray()"),
      use("iterator-filter", "Iterator.from([1, 2, 3]).filter(x).toArray()"),
      use("call", "x.call(null, 1, 2, [3])"),
      use("apply", "x.apply(null, [1, 2, [3]])"),
      use("reflect-apply", "Reflect.apply(x, null, [1, 2, [3]])"),
      use("call-call", "Function.prototype.call.call(x, null, 1, 2, [3])"),
      use("bind", "x.bind(null, 1)(2, [3])"),
      use("plain", "x(1, 2, [3])"),
      use("getter", 'Object.defineProperty({}, "p", { get: x }).p'),
      use("trap", "new Proxy({}, { get: x }).p"),
      later("then", "await Promise.resolve(1).then(x)"),
      later("catch", "await Promise.reject(1).catch(x)"),
      later("finally", "await Promise.resolve(1).finally(x)"),
      later("from-async", "await Array.fromAsync([1, 2], x)"),
      later("microtask", "await new Promise(done => { queueMicrotask(() => done(x(1, 2, [3]))); })", { needsHost: true }),
      later("timeout", "await new Promise(done => { setTimeout(() => done(x(1, 2, [3])), 0); })", { needsHost: true }),
      later("timeout-direct", "await new Promise(done => { setTimeout(x, 0, 1, 2, [3]); setTimeout(done, 1, \"done\"); })", { needsHost: true }),
      later("next-tick", "await new Promise(done => { process.nextTick(x, 1, 2, [3]); process.nextTick(done, \"done\"); })", { needsHost: true }),
    ],
  },
  {
    name: "reducer",
    kind: "callable",
    key: "",
    parameters: "total, v",
    deliver: returns,
    results: ["total + v", '"" + total + v', "[total, v]", "undefined", "v"],
    uses: [
      use("reduce", "[1, 2, 3].reduce(x)"),
      use("reduce-seeded", "[1, 2, 3].reduce(x, 0)"),
      use("reduce-right", "[1, 2, 3].reduceRight(x)"),
      use("iterator-reduce", "Iterator.from([1, 2, 3]).reduce(x)"),
    ],
  },
  {
    name: "reviver",
    kind: "callable",
    key: "",
    parameters: "k, v",
    deliver: returns,
    results: ["v", "k", "undefined", 'typeof v === "number" ? v + 1 : v', "[v]", '"s"'],
    uses: [
      use("parse", "JSON.parse('{\"a\":[1,2],\"b\":{\"c\":3}}', x)"),
      use("parse-number", 'JSON.parse("1", x)'),
      use("stringify", "JSON.stringify({ a: [1, 2], b: { c: 3 } }, x)"),
      use("stringify-number", "JSON.stringify(1, x)"),
    ],
  },
  {
    name: "replacement",
    kind: "callable",
    key: "",
    parameters: "found, ...rest",
    deliver: returns,
    results: ['"[" + found + "]"', "5", "undefined", "{ toString() { state.n++; return \"T\"; } }", "rest.length", "null"],
    uses: [
      use("regexp", '"abcb".replace(/b/, x)'),
      use("regexp-global", '"abcb".replace(/b/g, x)'),
      use("regexp-groups", '"abcb".replace(/(?<first>a)(b)/, x)'),
      use("string", '"abcb".replace("b", x)'),
      use("replace-all", '"abcb".replaceAll("b", x)'),
    ],
  },
  {
    name: "executor",
    kind: "callable",
    key: "",
    parameters: "resolve, reject",
    deliver: result => `resolve(${result});`,
    results: ["9", '"s"', "{ then(r) { state.n++; r(8); } }", "undefined", "Promise.resolve([1])"],
    ownBehaviors: { rejects: "reject(new Boom(3)); return;" },
    uses: [later("promise", "await new Promise(x)"), later("subclass", "await new (class extends Promise {})(x)")],
  },
  {
    name: "tag",
    kind: "callable",
    key: "",
    parameters: "strings, ...values",
    deliver: returns,
    results: ["strings.raw.length + values.length", "strings", "values", '"s"'],
    uses: [use("template", "x`a${1}b${2}c`")],
  },
];

const sharedHelpers = `
function setLength(list, length) { list.length = length; return list; }
function storeElement(list, value) { list[0] = value; return list[0]; }
function pairsOf(it) { const list = []; for (const v of it) list.push([v, 1]); return list; }
function nestedPattern(list) { const [[a]] = list; return a; }
function tryWeakSet(it) { new WeakSet(it); return "made"; }
function keysIn(t) { const list = []; for (const k in t) list.push(k); return list; }
function eachOf(t) { const list = []; Array.prototype.forEach.call(t, v => { list.push(v); }); return list; }
function setFrom(list, source) { list.set(source); return [...list]; }
function boundLength(t) { function f() {} Object.defineProperty(f, "length", { get() { return t.length; } }); return f.bind(null).length; }
`;

const behaviors: Record<string, { before: string; usesThis?: boolean; needsOther?: boolean; afterFirstRun?: string }> = {
  "reads-late-let": { before: 'log += lateLet + ";";', afterFirstRun: "let lateLet = 7;" },
  "reads-late-const-function": { before: 'log += lateFunction() + ";";', afterFirstRun: "const lateFunction = () => 8;" },
  "reads-late-class": { before: 'log += new LateClass().tag + ";";', afterFirstRun: "class LateClass { tag = 9; }" },
  "reads-late-var": { before: 'log += typeof lateVar + ";";', afterFirstRun: "var lateVar = 7;" },
  "reads-late-property": { before: 'log += typeof state.late + ";";', afterFirstRun: "state.late = 7;" },
  "reads-late-own-property": { before: 'log += typeof this.late + ";";', usesThis: true, afterFirstRun: "if (typeof o === \"object\" || typeof o === \"function\") o.late = 7;" },
  "stores-early-let": { before: "lateStored = 1;", afterFirstRun: "let lateStored = 2;" },
  plain: { before: "" },
  counts: { before: "calls++;" },
  writes: { before: "state.n++;" },
  retypes: { before: 'state.n = typeof state.n === "number" ? "text" : 1;' },
  reshapes: { before: "delete state.n; state.extra = 1;" },
  reparents: { before: "Object.setPrototypeOf(state, { n: \"inherited\" }); delete state.n;" },
  "defines-getter": { before: 'Object.defineProperty(state, "n", { get() { return "computed"; }, configurable: true });' },
  freezes: { before: "Object.freeze(state);" },
  "writes-own": { before: "this.n = (this.n | 0) + 1;", usesThis: true },
  "retypes-own": { before: 'this.n = "own";', usesThis: true },
  leaks: { before: "leaked = this;", usesThis: true },
  "leaks-arguments": { before: "leakedArguments = arguments.length;", usesThis: true },
  throws: { before: "throw new Boom(7);" },
  "throws-text": { before: 'throw "thrown text";' },
  "throws-second": { before: "if (++calls > 1) throw new Boom(calls);" },
  "throws-this": { before: "throw this;", usesThis: true },
  reenters: { before: "if (depth === 0) { depth = 1; reentered = run(other, state); depth = 0; }", needsOther: true },
  "writes-list": { before: "shared.push(shared.length); shared[0] = \"first\";" },
  "empties-list": { before: "shared.length = 0;" },
  "writes-variable": { before: 'variable = typeof variable === "number" ? "changed" : 2;' },
  captures: { before: "{ const mine = calls++; captured.push(() => mine); }" },
  "captures-this": { before: "{ const self = this; captured.push(() => self.n); }", usesThis: true },
};

const escapes = ["never", "before", "after", "inside-before", "closure-before", "thrown-before", "callee-before", "deep-before"] as const;
const mixes = ["alone", "laundered", "beside-unknown", "beside-other", "beside-primitive", "beside-five-escaped", "late-object", "local", "deep-use", "late-deep-object", "late-deep-after-undefined"] as const;
type Escape = (typeof escapes)[number];
type Mix = (typeof mixes)[number];

type Holder = (code: Code, escape: string) => string;

const functionOf = (code: Code, body = code.body) => `${code.functionKeyword} (${code.parameters}) { ${body} }`;
const methodOf = (code: Code, body = code.body) => `${code.methodPrefix}${code.key}(${code.parameters}) { ${body} }`;
const getterOf = (code: Code, body = code.body) => `get ${code.key}() { ${body} }`;

// The analysis meets the statement only after it has followed three calls, so whatever uses the object has been looked at before.
const deep = (statement: string) => `function third() { ${statement} }\nfunction second() { third(); }\nfunction first() { second(); }\nfirst();`;
const byCallback = (statement: string) => `[0].forEach(() => { ${statement} });`;

const methodHolders: Record<string, Holder> = {
  "added-deep": (c, e) => `const o = { n: 0 };\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "added-by-callback": (c, e) => `const o = { n: 0 };\n${e}\n${byCallback(`${c.member("o")} = ${functionOf(c)};`)}`,
  "added-deep-to-class": (c, e) => `class C { n = 0; }\nconst o = new C();\n${e}\n${deep(`${c.member("C.prototype")} = ${functionOf(c)};`)}`,
  "added-deep-to-prototype": (c, e) => `const p = {};\nconst o = Object.create(p);\no.n = 0;\n${e}\n${deep(`${c.member("p")} = ${functionOf(c)};`)}`,
  "replaced-deep": (c, e) => `const o = { n: 0, ${methodOf(c, c.decoyBody)} };\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "replaced-deep-on-class": (c, e) => `class C { n = 0; ${methodOf(c, c.decoyBody)} }\nconst o = new C();\n${e}\n${deep(`${c.member("C.prototype")} = ${functionOf(c)};`)}`,
  "prototype-changed-deep": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { n: 0 };\n${e}\n${deep("Object.setPrototypeOf(o, p);")}`,
  "prototype-changed-by-callback": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { n: 0 };\n${e}\n${byCallback("Object.setPrototypeOf(o, p);")}`,
  "defined-deep": (c, e) => `const o = { n: 0 };\n${e}\n${deep(`Object.defineProperty(o, ${c.keyExpression}, { value: ${functionOf(c)}, writable: true, configurable: true });`)}`,
  "array-added-late": (c, e) => `const o = [1, 2];\no.n = 0;\n${e}\n${c.member("o")} = ${functionOf(c)};`,
  "array-added-deep": (c, e) => `const o = [1, 2];\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "array-prototype-changed-deep": (c, e) => `const p = { __proto__: Array.prototype, ${methodOf(c)} };\nconst o = [1, 2];\no.n = 0;\n${e}\n${deep("Object.setPrototypeOf(o, p);")}`,
  "promise-added-deep": (c, e) => `const o = Promise.resolve(1);\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "map-added-deep": (c, e) => `const o = new Map([[1, 2]]);\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "date-added-deep": (c, e) => `const o = new Date(5);\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "regexp-added-deep": (c, e) => `const o = /b/;\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "wrapper-added-deep": (c, e) => `const o = Object(5);\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  "generator-added-deep": (c, e) => `const o = (function* () { yield 1; yield 2; })();\no.n = 0;\n${e}\n${deep(`${c.member("o")} = ${functionOf(c)};`)}`,
  own: (c, e) => `const o = { n: 0, ${methodOf(c)} };\n${e}`,
  "own-function": (c, e) => `const o = { n: 0, ${c.key}: ${functionOf(c)} };\n${e}`,
  "class-method": (c, e) => `class C { n = 0; ${methodOf(c)} }\nconst o = new C();\n${e}`,
  "class-field": (c, e) => `class C { n = 0; ${c.key} = ${functionOf(c)}; }\nconst o = new C();\n${e}`,
  inherited: (c, e) => `class B { ${methodOf(c)} }\nclass C extends B { n = 0; }\nconst o = new C();\n${e}`,
  "static-method": (c, e) => `class C { static n = 0; static ${methodOf(c)} }\nconst o = C;\n${e}`,
  "prototype-object": (c, e) => `const p = { ${methodOf(c)} };\nconst o = Object.create(p);\no.n = 0;\n${e}`,
  "prototype-literal": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { __proto__: p, n: 0 };\n${e}`,
  "two-levels": (c, e) => `const p = { ${methodOf(c)} };\nconst o = Object.create(Object.create(p));\no.n = 0;\n${e}`,
  "constructor-function": (c, e) => `function F() { this.n = 0; }\n${c.member("F.prototype")} = ${functionOf(c)};\nconst o = new F();\n${e}`,
  "constructor-prototype-replaced": (c, e) => `function F() { this.n = 0; }\nF.prototype = { ${methodOf(c)} };\nconst o = new F();\n${e}`,
  "added-late": (c, e) => `const o = { n: 0 };\n${e}\n${c.member("o")} = ${functionOf(c)};`,
  "added-late-to-instance": (c, e) => `class C { n = 0; }\nconst o = new C();\n${e}\n${c.member("o")} = ${functionOf(c)};`,
  "added-late-to-prototype": (c, e) => `const p = {};\nconst o = Object.create(p);\no.n = 0;\n${e}\n${c.member("p")} = ${functionOf(c)};`,
  "added-late-to-class": (c, e) => `class C { n = 0; }\nconst o = new C();\n${e}\n${c.member("C.prototype")} = ${functionOf(c)};`,
  "replaced-late": (c, e) => `const o = { n: 0, ${methodOf(c, c.decoyBody)} };\n${e}\n${c.member("o")} = ${functionOf(c)};`,
  "replaced-late-on-class": (c, e) => `class C { n = 0; ${methodOf(c, c.decoyBody)} }\nconst o = new C();\n${e}\n${c.member("C.prototype")} = ${functionOf(c)};`,
  "shadowed-late": (c, e) => `class C { n = 0; ${methodOf(c, c.decoyBody)} }\nconst o = new C();\n${e}\n${c.member("o")} = ${functionOf(c)};`,
  "prototype-changed-late": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { n: 0 };\n${e}\nObject.setPrototypeOf(o, p);`,
  "prototype-stored-late": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { n: 0 };\n${e}\no.__proto__ = p;`,
  "prototype-reflected-late": (c, e) => `const p = { ${methodOf(c)} };\nconst o = { n: 0 };\n${e}\nReflect.setPrototypeOf(o, p);`,
  "grandparent-changed-late": (c, e) => `const g = { ${methodOf(c)} };\nconst p = {};\nconst o = Object.create(p);\no.n = 0;\n${e}\nObject.setPrototypeOf(p, g);`,
  getter: (c, e) => `const o = { n: 0, get ${c.key}() { return ${functionOf(c)}; } };\n${e}`,
  "class-getter": (c, e) => `class C { n = 0; get ${c.key}() { return ${functionOf(c)}; } }\nconst o = new C();\n${e}`,
  "getter-defined-late": (c, e) => `const o = { n: 0 };\n${e}\nObject.defineProperty(o, ${c.keyExpression}, { get() { return ${functionOf(c)}; }, configurable: true });`,
  bound: (c, e) => `const target = { n: 0 };\nconst o = { n: 0, ${c.key}: ${functionOf(c)}.bind(target) };\n${e}`,
  "bound-late": (c, e) => `const target = { n: 0 };\nconst o = { n: 0 };\n${e}\n${c.member("o")} = ${functionOf(c)}.bind(target);`,
  "proxy-forwarding": (c, e) => `const target = { n: 0, ${methodOf(c)} };\nconst o = new Proxy(target, {});\n${e}`,
  "proxy-get-trap": (c, e) =>
    `const o = new Proxy({ n: 0 }, { get(t, k, r) { return k === ${c.keyExpression} ? ${functionOf(c)} : Reflect.get(t, k, r); } });\n${e}`,
  "proxy-as-prototype": (c, e) => `const o = Object.create(new Proxy({ ${methodOf(c)} }, {}));\no.n = 0;\n${e}`,
  "proxy-method": (c, e) => `const o = { n: 0, ${c.key}: new Proxy(${functionOf(c)}, {}) };\n${e}`,
  defined: (c, e) => `const o = { n: 0 };\nObject.defineProperty(o, ${c.keyExpression}, { value: ${functionOf(c)}, writable: true, configurable: true });\n${e}`,
  "defined-late": (c, e) => `const o = { n: 0 };\n${e}\nObject.defineProperty(o, ${c.keyExpression}, { value: ${functionOf(c)}, writable: true, configurable: true });`,
  "defined-properties-late": (c, e) => `const o = { n: 0 };\n${e}\nObject.defineProperties(o, { ${c.key}: { value: ${functionOf(c)}, writable: true, configurable: true } });`,
  assigned: (c, e) => `const o = Object.assign({ n: 0 }, { ${methodOf(c)} });\n${e}`,
  "assigned-late": (c, e) => `const o = { n: 0 };\n${e}\nObject.assign(o, { ${methodOf(c)} });`,
  "reflect-set-late": (c, e) => `const o = { n: 0 };\n${e}\nReflect.set(o, ${c.keyExpression}, ${functionOf(c)});`,
  "computed-key-late": (c, e) => `const keys = [${c.keyExpression}];\nconst o = { n: 0 };\n${e}\no[keys[keys.length - 1]] = ${functionOf(c)};`,
  "stored-through-alias": (c, e) => `const o = { n: 0 };\n${e}\nconst alias = new SuppressedError(o, 0).error;\n${c.member("alias")} = ${functionOf(c)};`,
  "stored-by-helper-late": (c, e) => `function install(t, f) { ${c.member("t")} = f; }\nconst o = { n: 0 };\n${e}\ninstall(o, ${functionOf(c)});\ninstall({}, function () {});`,
  "spread-copy": (c, e) => `const o = { n: 0, ...{ ${methodOf(c)} } };\n${e}`,
  "made-in-function": (c, e) => `function make() { return { n: 0, ${methodOf(c)} }; }\nmake();\nconst o = make();\n${e}`,
  "function-object": (c, e) => `function o() {}\no.n = 0;\n${c.member("o")} = ${functionOf(c)};\n${e}`,
  "array-object": (c, e) => `const o = [1, 2];\no.n = 0;\n${c.member("o")} = ${functionOf(c)};\n${e}`,
  "error-object": (c, e) => `const o = new Error("m");\no.n = 0;\n${c.member("o")} = ${functionOf(c)};\n${e}`,
  "array-subclass": (c, e) => `class C extends Array { n = 0; ${methodOf(c)} }\nconst o = new C();\n${e}`,
  "null-prototype": (c, e) => `const o = Object.create(null);\no.n = 0;\n${c.member("o")} = ${functionOf(c)};\n${e}`,
  "on-object-prototype-late": (c, e) => `const o = { n: 0 };\n${e}\nconst saved = ${c.member("Object.prototype")};\n${c.member("Object.prototype")} = ${functionOf(c)};`,
};

const getterHolders: Record<string, Holder> = {
  "defined-deep": (c, e) => `const o = { n: 0 };\n${e}\n${deep(`Object.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`)}`,
  "defined-by-callback": (c, e) => `const o = { n: 0 };\n${e}\n${byCallback(`Object.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`)}`,
  "defined-deep-on-class": (c, e) =>
    `class C { n = 0; }\nconst o = new C();\n${e}\n${deep(`Object.defineProperty(C.prototype, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`)}`,
  "replaces-data-deep": (c, e) =>
    `const o = { n: 0, ${c.key}: 0 };\n${e}\n${deep(`Object.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`)}`,
  "prototype-changed-deep": (c, e) => `const p = { ${getterOf(c)} };\nconst o = { n: 0 };\n${e}\n${deep("Object.setPrototypeOf(o, p);")}`,
  "array-defined-deep": (c, e) => `const o = [65];\no.n = 0;\n${e}\n${deep(`Object.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`)}`,
  own: (c, e) => `const o = { n: 0, ${getterOf(c)} };\n${e}`,
  "class-getter": (c, e) => `class C { n = 0; ${getterOf(c)} }\nconst o = new C();\n${e}`,
  "inherited-getter": (c, e) => `class B { ${getterOf(c)} }\nclass C extends B { n = 0; }\nconst o = new C();\n${e}`,
  "static-getter": (c, e) => `class C { static n = 0; static ${getterOf(c)} }\nconst o = C;\n${e}`,
  "prototype-getter": (c, e) => `const p = { ${getterOf(c)} };\nconst o = Object.create(p);\no.n = 0;\n${e}`,
  defined: (c, e) => `const o = { n: 0 };\nObject.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });\n${e}`,
  "defined-late": (c, e) => `const o = { n: 0 };\n${e}\nObject.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`,
  "defined-late-on-prototype": (c, e) =>
    `const p = {};\nconst o = Object.create(p);\no.n = 0;\n${e}\nObject.defineProperty(p, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`,
  "defined-late-on-class": (c, e) =>
    `class C { n = 0; }\nconst o = new C();\n${e}\nObject.defineProperty(C.prototype, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`,
  "legacy-define-late": (c, e) => `const o = { n: 0 };\n${e}\no.__defineGetter__(${c.keyExpression}, ${functionOf(c)});`,
  "replaces-data-late": (c, e) =>
    `const o = { n: 0, ${c.key}: 0 };\n${e}\nObject.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`,
  "prototype-changed-late": (c, e) => `const p = { ${getterOf(c)} };\nconst o = { n: 0 };\n${e}\nObject.setPrototypeOf(o, p);`,
  "proxy-get-trap": (c, e) =>
    `const o = new Proxy({ n: 0, ${c.key}: 0 }, { get(t, k, r) { if (k === ${c.keyExpression}) { ${c.body} } return Reflect.get(t, k, r); } });\n${e}`,
  "proxy-forwarding": (c, e) => `const o = new Proxy({ n: 0, ${getterOf(c)} }, {});\n${e}`,
  "bound-getter": (c, e) =>
    `const o = { n: 0 };\nObject.defineProperty(o, ${c.keyExpression}, { get: ${functionOf(c)}.bind({ n: 0 }), enumerable: true, configurable: true });\n${e}`,
  "defined-through-alias": (c, e) =>
    `const o = { n: 0 };\n${e}\nObject.defineProperty(new SuppressedError(o, 0).error, ${c.keyExpression}, { get: ${functionOf(c)}, enumerable: true, configurable: true });`,
  "made-in-function": (c, e) => `function make() { return { n: 0, ${getterOf(c)} }; }\nmake();\nconst o = make();\n${e}`,
  "descriptor-from-function": (c, e) =>
    `function describe(get) { return { get, enumerable: true, configurable: true }; }\nconst o = { n: 0 };\n${e}\nObject.defineProperty(o, ${c.keyExpression}, describe(${functionOf(c)}));`,
};

const callableHolders: Record<string, Holder & { hasNoThis?: boolean }> = {
  function: (c, e) => `function o(${c.parameters}) { ${c.body} }\n${e}`,
  "function-expression": (c, e) => `const o = ${functionOf(c)};\n${e}`,
  arrow: (c, e) => `const o = (${c.parameters}) => { ${c.body} };\n${e}`,
  bound: (c, e) => `const o = ${functionOf(c)}.bind({ n: 0 });\n${e}`,
  "bound-twice": (c, e) => `const o = ${functionOf(c)}.bind({ n: 0 }).bind(null);\n${e}`,
  proxy: (c, e) => `const o = new Proxy(${functionOf(c)}, {});\n${e}`,
  "proxy-apply": (c, e) => `const o = new Proxy(function () {}, { apply(t, self, [${c.parameters}]) { ${c.body} } });\n${e}`,
  method: (c, e) => `const holder = { m(${c.parameters}) { ${c.body} } };\nconst o = holder.m;\n${e}`,
  "static-method": (c, e) => `class C { static m(${c.parameters}) { ${c.body} } }\nconst o = C.m;\n${e}`,
  "made-in-function": (c, e) => `function make() { return ${functionOf(c)}; }\nmake();\nconst o = make();\n${e}`,
  "from-list": (c, e) => `const list = [function () { ${c.decoyBody} }, ${functionOf(c)}];\nconst o = list[list.length - 1];\n${e}`,
  "from-getter": (c, e) => `const holder = { get f() { return ${functionOf(c)}; } };\nconst o = holder.f;\n${e}`,
  wrapper: (c, e) => `const inner = ${functionOf(c)};\nconst o = function (...list) { return inner.apply(this, list); };\n${e}`,
};

function holdersOf(kind: Kind): Record<string, Holder> {
  return kind === "method" ? methodHolders : kind === "getter" ? getterHolders : callableHolders;
}

function codeOf(family: Family, before: string, result: string): Code {
  const key = family.key;
  const isComputed = key.startsWith("[");
  const isIndex = /^[0-9]+$/.test(key);
  return {
    key,
    keyExpression: isComputed ? key.slice(1, -1) : isIndex ? key : JSON.stringify(key),
    member: base => (isComputed ? base + key : isIndex ? `${base}[${key}]` : `${base}.${key}`),
    parameters: family.parameters,
    body: `${before} ${family.deliver(result)}`.trim(),
    decoyBody: family.deliver(family.results[0]),
    methodPrefix: { "": "", "*": "*", async: "async ", "async*": "async *" }[family.modifier ?? ""],
    functionKeyword: { "": "function", "*": "function*", async: "async function", "async*": "async function*" }[family.modifier ?? ""],
  };
}

interface Point {
  family: string;
  use: string;
  holder: string;
  escape: Escape;
  mix: Mix;
  behavior: string;
}

const nameOf = (p: Point) => [`${p.family}.${p.use}`, p.holder, p.escape, p.mix, p.behavior].join("--");

function parseName(name: string): Point {
  const [familyAndUse, holder, escape, mix, behavior] = name.replace(/\.js$/, "").split("--");
  const dot = familyAndUse.indexOf(".");
  return { family: familyAndUse.slice(0, dot), use: familyAndUse.slice(dot + 1), holder, escape: escape as Escape, mix: mix as Mix, behavior };
}

function behaviorNamesOf(family: Family): string[] {
  return [
    ...Object.keys(behaviors),
    ...Object.keys(family.ownBehaviors ?? {}),
    ...family.results.slice(1).map((_, index) => `result-${index + 1}`),
    ...family.results.slice(1).map((_, index) => `alternates-${index + 1}`),
  ];
}

function escapeStatement(escape: Escape, flavor: Flavor): string {
  switch (escape) {
    case "never":
    case "after":
      return "";
    case "before":
      return "sink(o);";
    case "inside-before":
      return "sink({ inner: [o] });";
    case "closure-before":
      return "sink(() => o);";
    case "thrown-before":
      return "try { sink({ get trap() { throw o; } }.trap); } catch (e) { sink(e); }";
    case "callee-before":
      return flavor === "shell" ? "noInline(o);" : "sink(o);";
    case "deep-before":
      return "function escapeThird() { sink(o); }\nfunction escapeSecond() { escapeThird(); }\nfunction escapeFirst() { escapeSecond(); }\nescapeFirst();";
  }
}

function programOf(point: Point, flavor: Flavor): string | null {
  const family = families.find(f => f.name === point.family);
  const chosenUse = family?.uses.find(u => u.name === point.use);
  if (!family || !chosenUse) return null;
  if (chosenUse.needsHost && flavor !== "bun") return null;
  const holder = holdersOf(family.kind)[point.holder];
  if (!holder) return null;

  let before = "";
  let result = family.results[0];
  const shared = behaviors[point.behavior];
  if (shared) {
    if (shared.usesThis && (family.kind === "callable" || point.holder === "arrow")) return null;
    if (shared.needsOther && chosenUse.isAsync) return null;
    before = shared.before;
  } else if (family.ownBehaviors?.[point.behavior] !== undefined) {
    before = family.ownBehaviors[point.behavior];
  } else {
    const match = /^(result|alternates)-([0-9]+)$/.exec(point.behavior);
    if (!match || !family.results[+match[2]]) return null;
    result = match[1] === "result" ? family.results[+match[2]] : `(calls++ % 2 ? ${family.results[+match[2]]} : ${family.results[0]})`;
  }
  if (point.holder === "on-object-prototype-late" && !["valueOf", "toString", "toJSON", "then", "toLocaleString"].includes(family.name)) return null;
  if (point.holder === "legacy-define-late" && family.key.startsWith("[")) return null;
  if (point.holder === "date-added-deep" && family.name === "toPrimitive") return null;
  if (point.holder === "function-object" && family.name === "hasInstance") return null;
  if (point.holder === "regexp-added-deep" && family.membersStoredAfter?.some(text => text.startsWith("o.flags"))) return null;
  if (point.holder === "map-added-deep" && family.membersStoredAfter?.some(text => text.startsWith("o.size"))) return null;
  if (chosenUse.needsHost && point.mix === "late-deep-after-undefined") return null;
  if (point.holder === "array-defined-deep" && ["length", "0"].includes(family.key)) return null;
  if (point.holder.startsWith("array-") && family.membersStoredAfter?.some(text => text.startsWith("o.length") || text.startsWith("o[0]"))) return null;
  if (point.holder === "static-getter" && ["length", "name"].includes(family.key)) return null;
  if (point.holder === "function-object" && ["apply", "length", "name"].includes(family.key)) return null;
  if (point.holder === "static-method" && ["apply"].includes(family.key)) return null;
  if (["static-getter", "static-method", "function-object"].includes(point.holder) && family.membersStoredAfter?.some(text => text.startsWith("o.length"))) return null;
  const throwsOutOfHost = /^(throws|reads-late-let|reads-late-const|reads-late-class|stores-early)/.test(point.behavior);
  if ((["timeout-direct", "next-tick"].includes(chosenUse.name) || family.name === "handleEvent") && throwsOutOfHost) return null;

  const code = codeOf(family, before, result);
  const plain = codeOf(family, "", family.results[0]);
  const print = flavor === "shell" ? "print" : "report";
  const isAsync = !!chosenUse.isAsync;

  const operand: Record<Mix, string> = {
    alone: "o",
    laundered: "new SuppressedError(o, 0).error",
    "beside-unknown": "choose(o)",
    "beside-other": "o",
    "beside-primitive": "o",
    "beside-five-escaped": "chooseAmong(o)",
    "late-object": "o",
    local: "o",
    "deep-use": "o",
    "late-deep-object": "o",
    "late-deep-after-undefined": "o",
  };
  const isLocal = point.mix === "local";
  if (isLocal && (point.escape === "after" || point.holder === "on-object-prototype-late" || /this/.test(point.behavior) || shared?.needsOther)) return null;
  const other =
    family.kind === "callable"
      ? `function other(${plain.parameters}) { ${plain.body} }`
      : family.kind === "getter"
        ? `const other = { n: 0, ${getterOf(plain)} };`
        : `const other = { n: 0, ${methodOf(plain)} };`;
  const storedAfter = (family.membersStoredAfter ?? []).join("\n");

  const isDeep = ["deep-use", "late-deep-object", "late-deep-after-undefined"].includes(point.mix);
  const callThrough = (entry: string, argument: string) => (isAsync ? `${print}(await ${entry}(${argument}, state));` : `${print}(${entry}(${argument}, state));`);
  const call = (argument: string) => callThrough(isDeep ? "runFirst" : "run", argument);
  const lines: string[] = [];
  if (point.mix === "late-object" || point.mix === "late-deep-object") lines.push(callThrough("run", family.kind === "callable" ? "other" : "5"));
  if (point.mix === "late-deep-after-undefined") lines.push(callThrough("run", "undefined"));
  lines.push(call(operand[point.mix]));
  if (isLocal) lines.push("churn(40);");
  const afterFirstRun = shared?.afterFirstRun;
  if (afterFirstRun && (isLocal || point.holder.startsWith("proxy"))) return null;
  if (afterFirstRun && !isAsync) lines.push(afterFirstRun);
  if (point.mix === "beside-other") lines.push(call("other"));
  if (point.mix === "beside-primitive") lines.push(call(family.kind === "callable" ? "other" : "5"));
  if (point.escape === "after") lines.push("sink(o);");
  lines.push(call(operand[point.mix]));
  if (point.holder === "on-object-prototype-late") lines.push(`${code.member("Object.prototype")} = saved;`);
  lines.push(`${print}(show(state.n), show(variable), show(shared), calls, log, show(reentered), show(leakedArguments));`);
  lines.push(`{ let text = ""; for (const f of captured) text += show(f()) + ","; ${print}(text); }`);
  lines.push(`if (leaked !== undefined) { ${print}(show(leaked.n)); leaked.n = 41; ${print}(leaked === o, show(leaked.n)); }`);
  if (family.kind !== "callable" && !isLocal) lines.push(`${print}(show(readOwn(o)));`);

  const holderText = `${holder(code, escapeStatement(point.escape, flavor))}\n${storedAfter}`;
  const runHead = isLocal
    ? `function run(ignored, s) {\n${holderText}\nconst x = o;`
    : `function run(x, s) {`;

  return `${flavor === "bun" ? `function report(...list) { console.log(${JSON.stringify(nameOf(point))}, ...list); }\n` : ""}let calls = 0, depth = 0, count = 0, log = "", leaked, leakedArguments, reentered, variable = 1;
const state = { n: 1 };
const shared = [1, 2, 3];
const captured = [];
function churn(depth) { const block = { a: depth, b: [depth, depth], c: "" + depth }; return depth > 0 ? churn(depth - 1) + block.b.length : block.a; }
class Boom { constructor(code) { this.code = code; } }
function sink(v) { new SuppressedError(v, 0); }
const unknownValue = new SuppressedError(undefined, 0).error;
function choose(v) { return unknownValue === undefined ? v : unknownValue; }
function chooseAmong(v) {
  const list = [v, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }];
  for (const each of list) sink(each);
  let chosen = unknownValue;
  for (let i = list.length - 1; i >= 0; i--) chosen = list[i];
  return chosen;
}
function readOwn(v) { try { return v.n; } catch (e) { return "no n"; } }
function show(v, depth = 0) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string") return '"' + v + '"';
  if (t === "bigint") return v + "n";
  if (t === "symbol") return "symbol";
  if (t === "function") return "function";
  if (t !== "object") return Object.is(v, -0) ? "-0" : "" + v;
  if (v === o) return "holder";
  if (v === state) return "state";
  if (v instanceof Boom) return "Boom(" + show(v.code, depth + 1) + ")";
  if (v instanceof Error) return v.name;
  if (depth > 3) return "...";
  if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i ? "," : "") + show(v[i], depth + 1); return s + "]"; }
  let s = "{";
  for (const k in v) s += k + ":" + show(v[k], depth + 1) + ",";
  return s + "}";
}
${sharedHelpers}${family.helpers ?? ""}
${other}
${isLocal ? "const o = { isNotTheHolder: true };" : holderText}
${storedAfter.replaceAll("o.", "other.").replaceAll("o[", "other[")}
${isAsync ? "async " : ""}${runHead}
  ${family.beforeEachRun ?? ""}
  const before = s.n, ownBefore = readOwn(x), variableBefore = variable, firstBefore = shared[0], lengthBefore = shared.length;
  let r, kind;
  try { r = ${chosenUse.text}; kind = typeof r; } catch (e) { r = ["threw", e]; kind = "thrown " + typeof e; }
  return show(before) + " " + show(s.n) + " | " + show(ownBefore) + " " + show(readOwn(x)) + " | " + show(variableBefore) + " " + show(variable)
    + " | " + show(firstBefore) + " " + show(shared[0]) + " " + lengthBefore + " " + shared.length + " | " + kind + " " + show(r);
}
function runThird(x, s) { return run(x, s); }
function runSecond(x, s) { return runThird(x, s); }
function runFirst(x, s) { return runSecond(x, s); }
${isAsync ? `async function main() {\n${lines.join("\n")}\n}\nmain().catch(e => ${print}("main failed", show(e)));\n${afterFirstRun ?? ""}` : lines.join("\n")}
`;
}

/** One point of the cross product, drawn at random. Its first line spells the point. */
export function generate(random: Random, _typed: boolean, profile: { library: boolean } = { library: true }): string {
  const allUses = families.flatMap(family => family.uses.map(chosen => ({ family, chosen })));
  for (;;) {
    const { family, chosen } = random.pick(allUses);
    const point: Point = {
      family: family.name,
      use: chosen.name,
      holder: random.pick(Object.keys(holdersOf(family.kind))),
      escape: random.pick(escapes),
      mix: random.pick(mixes),
      behavior: random.pick(behaviorNamesOf(family)),
    };
    const text = programOf(point, profile.library ? "bun" : "shell");
    if (text !== null) return `// ${nameOf(point)}\n${text}`;
  }
}

function randomOf(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function argumentOf(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  const flavor = (argumentOf("flavor") ?? "shell") as Flavor;

  if (process.argv.includes("--list")) {
    const uses = families.reduce((total, family) => total + family.uses.length, 0);
    console.log(`${families.length} families, ${uses} uses`);
    console.log(`${Object.keys(methodHolders).length} holders of a method, ${Object.keys(getterHolders).length} of a getter, ${Object.keys(callableHolders).length} callables`);
    console.log(`${escapes.length} escapes, ${mixes.length} mixes, ${Object.keys(behaviors).length} shared behaviors`);
  } else if (argumentOf("name")) {
    const text = programOf(parseName(argumentOf("name")!), flavor);
    if (text === null) throw new Error("no such point");
    process.stdout.write(text);
  } else {
    const out = argumentOf("out");
    if (!out) throw new Error("--out <folder>");
    mkdirSync(out, { recursive: true });
    const count = +(argumentOf("count") ?? 2000);
    const random = randomOf(+(argumentOf("seed") ?? 1));
    const only = argumentOf("only") ? new RegExp(argumentOf("only")!) : undefined;
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    const allUses = families.flatMap(family => family.uses.map(chosen => ({ family, chosen })));
    const written = new Set<string>();
    for (let attempts = 0; written.size < count && attempts < count * 200; attempts++) {
      const { family, chosen } = pick(allUses);
      const point: Point = {
        family: family.name,
        use: chosen.name,
        holder: pick(Object.keys(holdersOf(family.kind))),
        escape: pick(escapes),
        mix: pick(mixes),
        behavior: pick(behaviorNamesOf(family)),
      };
      const name = nameOf(point);
      if (written.has(name) || (only && !only.test(name))) continue;
      const text = programOf(point, flavor);
      if (text === null) continue;
      written.add(name);
      writeFileSync(join(out, `${name}.js`), text);
    }
    // A bundle is one program that imports several of the programs. One build then tries them all, and a runner goes back to the single programs where a bundle differs.
    const bundleSize = +(argumentOf("bundle") ?? 0);
    if (bundleSize) {
      const names = [...written];
      for (let first = 0, index = 0; first < names.length; first += bundleSize, index++) {
        const imports = names.slice(first, first + bundleSize).map(name => `import ${JSON.stringify(`./${name}.js`)};`);
        writeFileSync(join(out, `bundle-${String(index).padStart(4, "0")}.mjs`), imports.join("\n") + "\n");
      }
    }
    console.log(`${written.size} programs`);
  }
}
