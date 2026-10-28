// An operation that throws does so whether or not anybody wants what it would have answered. Each case writes one operation where its result is dropped, or goes into something that is dropped, and says how the function ended.
// The table: where the operation stands x the operation. A few of the operations complete, so that a case that always says "throws" is noticed.
//
//   bun operations-that-throw-where-nobody-uses-the-result.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/<where the operation stands>.js.
import { writeCaseFiles, type CaseFile } from "./case-files";

const operations = [
  `"a,b".split(",")`, `nothing.split(",")`, `"a".split(symbol)`, `"a".repeat(-1)`, `"a".repeat(Infinity)`, `"a".normalize("bad")`, `"a".padStart(4, symbol)`, `"a".localeCompare("b", "not_a_locale")`,
  `"a".at(symbol)`, `"abc".substring(symbol)`, `"abc".slice(big)`, `"abc".charCodeAt(big)`, `"abc".codePointAt(symbol)`, `"abc".concat(symbol)`, `"abc".includes(/a/)`, `"abc".startsWith(/a/)`, `"abc".endsWith(/a/)`,
  `"abc".matchAll(/a/)`, `"abc".replaceAll(/a/, "b")`, `"abc".match(symbol)`, `/a/.exec(symbol)`, `/a/.test(symbol)`, `String.fromCodePoint(-1)`, `String.raw(nothing)`, `new String(symbol)`, `String(symbol)`, "`${symbol}`", `symbol + ""`, `"" + symbol`,
  `new Array(-1)`, `new Array(1.5)`, `Array(-1)`, `new Array(4294967296)`, `[].reduce((a, b) => a)`, `[].reduceRight((a, b) => a)`, `[1].map(7)`, `[1].filter(nothing)`, `[1].forEach(7)`, `[1].find(7)`, `[1].sort(7)`, `[1].toSorted(7)`, `[1].with(5, 1)`, `[1].flatMap(7)`, `[1, 2].toSpliced(big)`,
  `Array.from(nothing)`, `Array.from([1], 7)`, `Array.prototype.splice.call(nothing)`, `[1, 2].splice(symbol)`, `[1].join(symbol)`, `[symbol].join()`, `[1].fill(1, symbol)`, `[1].at(big)`, `[1].includes(1, symbol)`, `[1].indexOf(1, big)`,
  `new Map(7)`, `new Set(7)`, `new WeakMap(7)`, `new WeakSet(7)`, `new Map([1])`, `new WeakSet([1])`, `new WeakMap([[1, 1]])`, `new WeakRef(1)`, `Map()`, `Set()`, `Promise()`, `new Promise(7)`, `new Promise()`, `Symbol.keyFor(1)`, `new Symbol()`, `new BigInt(1)`,
  `new ArrayBuffer(-1)`, `new Uint8Array(-1)`, `new Uint32Array(new ArrayBuffer(3))`, `new DataView(1)`, `new DataView(new ArrayBuffer(1), 2)`, `new Uint8Array(1).set([1, 2])`, `new BigInt64Array(1).fill(1)`, `new Uint8Array(1).fill(big)`, `new Uint8Array(2).subarray(symbol)`, `new DataView(new ArrayBuffer(1)).getInt32(0)`,
  `(1).toFixed(101)`, `(1).toString(1)`, `(1).toPrecision(0)`, `(1).toExponential(101)`, `BigInt(1.5)`, `BigInt("x")`, `BigInt(nothing)`, `big + 1`, `1 + big`, `big * 1`, `-symbol`, `+big`, `+symbol`, `big >>> 0n`, `1n / 0n`, `1n % 0n`, `2n ** -1n`, `Math.max(big)`, `Math.abs(symbol)`, `Math.floor(big)`, `Number(symbol)`, `isNaN(symbol)`, `parseInt(symbol)`, `parseFloat(symbol)`, `BigInt.asIntN(-1, 1n)`, `Number.prototype.valueOf.call("a")`,
  `JSON.parse("{")`, `JSON.parse(symbol)`, `JSON.stringify(big)`, `JSON.stringify({ a: big })`, `JSON.stringify(cyclic)`, `new RegExp("(")`, `new RegExp("a", "zz")`, `RegExp("[")`, `decodeURIComponent("%")`, `decodeURI("%")`, `encodeURIComponent("\\ud800")`, `encodeURI("\\udc00")`,
  `new Date(NaN).toISOString()`, `new Date(symbol)`, `Date.prototype.getTime.call(1)`, `new Date(big)`, `new Date().toLocaleString("not_a_locale")`, `new Intl.NumberFormat("not_a_locale")`, `new Intl.DateTimeFormat("en", { timeZone: "Nowhere/Land" })`, `new Intl.Collator("en", { usage: "nope" })`,
  `Object.defineProperty(1, "a", {})`, `Object.defineProperty({}, "a", 1)`, `Object.defineProperty({}, "a", { get: 1 })`, `Object.defineProperties({}, nothing)`, `Object.create(1)`, `Object.create(null, nothing ?? null)`, `Object.setPrototypeOf(nothing, null)`, `Object.setPrototypeOf({}, 1)`, `Object.setPrototypeOf(Object.freeze({}), {})`, `Object.keys(nothing)`, `Object.entries(nothing)`, `Object.values(nothing)`, `Object.assign(nothing)`, `Object.fromEntries(7)`, `Object.fromEntries([1])`, `Object.getOwnPropertyDescriptor(nothing, "a")`, `Object.getOwnPropertyNames(nothing)`, `Object.getPrototypeOf(nothing)`, `Object.groupBy(nothing, x => x)`, `Object.hasOwn(nothing, "a")`, `Object.prototype.toString.call(revoked)`,
  `Reflect.ownKeys(1)`, `Reflect.get(1, "a")`, `Reflect.has(1, "a")`, `Reflect.getOwnPropertyDescriptor(1, "a")`, `Reflect.construct(1, [])`, `Reflect.apply(1)`, `Reflect.getPrototypeOf(1)`, `Reflect.defineProperty(1, "a", {})`, `new Proxy(1, {})`, `new Proxy({}, 1)`, `Proxy({}, {})`, `Proxy.revocable(1, {})`,
  `1 in 1`, `"a" in "b"`, `({}) instanceof 1`, `({}) instanceof (() => {})`, `nothing.a`, `nothing[0]`, `nothing?.a.b.c`, `nothing()`, `(1)()`, `new 1()`, `new (() => {})()`, `({}).a.b`, `({}).a()`, `[...nothing]`, `[...7]`, `({ ...nothing })`, `Math.max(...7)`, `new Map(...[7])`, `(({ a }) => a)(nothing)`, `(([a]) => a)(7)`, `(([a]) => a)(nothing)`, `late`, `typeof late`, `missing`, `typeof missing`, `frozen.a = 1`, `delete frozen.a`, `getterOnly.a = 1`, `thrower.a`, `thrower.b = 1`, `"a" in thrower`, `delete thrower.a`, `Object.keys(thrower)`, `({ ...throwingGetter })`, `[...throwingIterable]`, `Array.from(throwingIterable)`, `new Set(throwingIterable)`, "`${throwingToString}`", `throwingToString + ""`, `+throwingValueOf`, `throwingValueOf < 1`, `throwingValueOf == 1`, `[throwingToString].join()`, `"a".concat(throwingToString)`, `"a".indexOf(throwingToString)`, `new Array(throwingValueOf)`, `"a".repeat(throwingValueOf)`, `[1].at(throwingValueOf)`, `({})[throwingToString]`, `Math.max(1, throwingValueOf)`, `new Date(throwingValueOf)`, `String(throwingToString)`, `Number(throwingValueOf)`, `JSON.stringify(throwingToJSON)`, `JSON.stringify({ a: throwingGetter })`, `structuredClone(() => {})`, `structuredClone(symbol)`,
  `new (class extends Base { constructor() { } })()`, `new (class extends Base { constructor() { this.a = 1; super(); } })()`, `new (class extends Base { constructor() { super(); super(); } })()`, `new (class { #a; static has(o) { return o.#a; } }).constructor.has({})`, `(class { static #a = 1; static get(o) { return o.#a; } }).get({})`, `(class A { static a = A.b.c; })`, `(class extends 1 {})`, `(class extends nothing {})`, `Base()`, `new (class { constructor() { return 1; } })()`, `new (class extends Base { constructor() { return 1; } })()`, `new (class { a = nothing.b; })()`, `new (class { [throwingToString] = 1; })()`,
  `atob("*")`, `btoa("\\u0100")`, `new URL("x")`, `new URL("x", "y")`, `new TextDecoder("nope")`, `new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([255]))`, `Buffer.alloc(-1)`, `Buffer.from(nothing)`, `Buffer.from(1)`, `Buffer.alloc(1).readInt32LE(0)`, `Buffer.alloc(1).writeUInt8(256)`, `new URLSearchParams([[1]])`, `new Headers([[1]])`, `new Headers({ "a b": "c" })`, `new Response(null, { status: 1 })`, `new Request("x")`, `new AbortController().signal.throwIfAborted()`, `AbortSignal.abort().throwIfAborted()`, `queueMicrotask(1)`, `new Blob(1)`, `new EventTarget().addEventListener()`, `new Event()`, `crypto.getRandomValues(1)`, `crypto.randomUUID.call(1)`, `performance.measure("a", "nope")`, `setTimeout()`, `new Intl.Segmenter("en", { granularity: "nope" })`, `Symbol.prototype.toString.call(1)`, `Symbol.prototype.description`, `Function.prototype.toString.call(1)`, `Function.prototype.call.call(1)`, `(function () { "use strict"; return arguments.callee; })()`, `(() => {}).bind.call(1)`, `new Function("(")`, `eval("(")`, `generator().next.call(1)`, `running()`, `Iterator.from(1)`, `[1].values().map(7)`, `[1].values().take(-1)`, `[1].values().drop(NaN)`, `Promise.resolve.call(1)`, `Promise.all.call(1, [])`, `Promise.withResolvers.call(1)`, `new FinalizationRegistry(1)`, `new WeakRef(symbolFor)`, `Atomics.add([1], 0, 1)`, `Atomics.wait(new Int32Array(1), 0, 0)`, `new SharedArrayBuffer(-1)`, `Error.captureStackTrace(1)`, `new AggregateError(7)`, `new Error("a", { get cause() { throw new RangeError("cause"); } })`,
];

const places: [name: string, write: (operation: string) => string][] = [
  ["statement", e => `${e};`],
  ["constant", e => `const unused = ${e};`],
  ["field-of-a-literal", e => `const unused = { a: ${e} };`],
  ["element-of-a-list", e => `const unused = [${e}];`],
  ["held-by-a-closure", e => `const held = ${e}; const unused = () => held;`],
  ["stored-into-a-field", e => `const object = {}; object.a = ${e};`],
  ["statement-in-a-loop", e => `for (let i = 0; i < 2; i++) { ${e}; }`],
  ["argument-of-a-constructor", e => `const unused = new Holder(${e});`],
  ["field-beside-a-method", e => `const unused = { method() { return 1; }, a: ${e} };`],
  ["element-that-a-pattern-skips", e => `const [first] = [1, ${e}];`],
  ["field-that-a-pattern-skips", e => `const { a } = { a: 1, b: ${e} };`],
  ["operand-of-void", e => `void (${e});`],
  ["assigned-on-one-path", e => `let unused = 1; if (flag) unused = ${e};`],
  ["arm-of-a-conditional", e => `const unused = flag ? (${e}) : 0;`],
  ["result-of-a-callback", e => `const unused = [1, 2].map(() => (${e}));`],
  ["statement-of-a-function-called-at-once", e => `(() => { ${e}; })();`],
  ["element-of-a-list-that-is-only-measured", e => `const unused = \`x\${[${e}].length}\`;`],
  ["argument-that-the-callee-ignores", e => `identity(1, ${e});`],
];

const asStatements = ["statement", "statement-in-a-loop", "operand-of-void", "statement-of-a-function-called-at-once"];
const leftOut: Record<string, string[]> = {
  "late": asStatements,
  "typeof late": asStatements,
  "(class extends 1 {})": ["operand-of-void"],
  "(class extends nothing {})": ["operand-of-void"],
};

const spelled: Record<string, string> = { "+": "plus", "-": "minus", "*": "times", "/": "over", "%": "modulo", "<": "below", ">": "above", "=": "is", "?": "maybe", "#": "private", "$": "put-in", "[": "list", "{": "braces", "(": "", "`": "template", '"': "", ".": "", ",": "", ";": "", ":": "", ")": "", "]": "", "}": "", "\\": "", "!": "not", "&": "and", "|": "or", "'": "", "_": "" };
const taken = new Map<string, number>();
function nameOf(operation: string) {
  const words = operation.replace(/[^A-Za-z0-9 ]/g, sign => ` ${spelled[sign] ?? ""} `).trim().split(/\s+/).join("-").toLowerCase().slice(0, 60);
  const times = (taken.get(words) ?? 0) + 1;
  taken.set(words, times);
  return times > 1 ? `${words}-${times}` : words;
}

const head = `// Operations that throw, written where nobody uses what they would have answered.
const nothing = globalThis.neverDefined, symbol = Symbol("s"), symbolFor = Symbol.for("f"), big = 1n, flag = process.argv.length > 0, frozen = Object.freeze({ a: 1 });
const cyclic = {}; cyclic.self = cyclic;
const getterOnly = { get a() { return 1; } };
const thrower = new Proxy({}, { get() { throw new RangeError("get"); }, set() { throw new RangeError("set"); }, has() { throw new RangeError("has"); }, deleteProperty() { throw new RangeError("delete"); }, ownKeys() { throw new RangeError("keys"); } });
const revoked = (() => { const r = Proxy.revocable([], {}); r.revoke(); return r.proxy; })();
const throwingGetter = { get a() { throw new RangeError("getter"); } };
const throwingIterable = { [Symbol.iterator]() { throw new RangeError("iterator"); } };
const throwingToString = { toString() { throw new RangeError("toString"); } };
const throwingValueOf = { valueOf() { throw new RangeError("valueOf"); } };
const throwingToJSON = { toJSON() { throw new RangeError("toJSON"); } };
class Base {} class Holder { constructor(a) { this.a = a; } }
function identity(a) { return a; }
function* generator() { yield 1; }
function running() { let g; function* self() { g.next(); } g = self(); g.next(); }
function t(name, f) { let ending; try { f(); ending = "completes"; } catch (e) { ending = "throws " + e?.constructor?.name; } console.log(name, ending); }
`;

export const caseFiles = (): CaseFile[] => {
  taken.clear();
  const named = operations.map(operation => ({ operation, name: nameOf(operation) }));
  return places.map(([place, write]) => ({
    name: `${place}.js`,
    head,
    cases: named
      .filter(({ operation }) => !leftOut[operation]?.includes(place))
      .map(({ operation, name }) => ({ name: `${place} ${name}`, line: `t("${place} ${name}", function () { ${write(operation)} });` })),
    tail: "let late = 1;\n",
  }));
};

if (import.meta.main) writeCaseFiles(caseFiles());
