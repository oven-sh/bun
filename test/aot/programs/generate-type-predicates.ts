// The programs of type-predicates that are not written by hand: `bun test/aot/generate.ts type-predicates <where>` writes them. Each predicate on types is asked of each kind of value, twice:
// of the value where it is written, so that the compiler knows its type; and of the same value out of a box that has held every kind, so that it knows nothing,
// with a look at the value in both arms, which goes by whatever the test is taken to have proven.
// Every question stands in place: a function that all the values went through would ask each of them about a value nobody knows.
import type { WrittenProgram } from "../generate";

const written: WrittenProgram[] = [];

const prelude = `import { types } from "node:util";
class Animal { constructor(name) { this.name = name; } }
class Dog extends Animal {}
class Stack extends Array {}
class Failure extends Error {}
class Even { static [Symbol.hasInstance](value) { return value % 2 === 0; } }
function Old(name) { this.name = name; }
const Bound = Animal.bind(null);
const revoked = () => { const made = Proxy.revocable([], {}); made.revoke(); return made.proxy; };
const box = { held: undefined };
const mix = value => { box.held = value; return box.held; };
const out = (label, answer) => console.log(label, typeof answer === "symbol" ? "symbol" : String(answer));
const t = read => { try { const value = read(); return typeof value === "function" ? "function" : typeof value === "symbol" ? "symbol" : typeof value === "object" && value ? "object" : String(value); } catch (error) { return error.constructor.name; } };
`;

const values: readonly string[] = [
  "undefined", "null", "true", "false", "0", "-0", "1", "-1", "1.5", "NaN", "Infinity", "2 ** 31", "2 ** 53", "1n", '""', '"a"', '"1"', 'Symbol("s")', "Symbol.iterator",
  "{}", '{ name: "n" }', "{ then() {} }", "{ length: 1 }", "Object.create(null)", '{ __proto__: { name: "above" } }', "{ constructor: Animal }",
  "[]", "[1]", "[, 1]", "new Array(2)", "new Stack()", "Stack.of(1)",
  "function () {}", "() => 1", "async () => {}", "function* () {}", "class {}", "Animal", "Bound", "Math.max",
  'new Animal("a")', 'new Dog("d")', 'new Old("o")', "new Date(0)", "new Date(NaN)", "/r/", 'new Error("e")', 'new TypeError("t")', 'new Failure("f")',
  "new Map()", "new Set()", "new WeakMap()", "Promise.resolve(1)", "new Uint8Array(2)", "new Float64Array(1)", "new DataView(new ArrayBuffer(1))", "new ArrayBuffer(1)", "Buffer.alloc(1)",
  "new Number(1)", 'new String("s")', "new Boolean(false)", "Object(1n)", 'Object(Symbol("o"))',
  "new Proxy([], {})", "new Proxy({}, {})", "new Proxy(function () {}, {})", "new Proxy(new Date(0), {})", 'new Proxy(new Error("p"), {})', "revoked()",
  'Object.assign([], { [Symbol.toStringTag]: "Tagged" })', '{ [Symbol.toStringTag]: "Array" }', '{ get [Symbol.toStringTag]() { return "Date"; } }',
  "Object.setPrototypeOf({}, Array.prototype)", "Object.setPrototypeOf([], null)", "Object.setPrototypeOf([], Object.prototype)", "Object.setPrototypeOf({}, Animal.prototype)",
  "Object.create(Date.prototype)", "Object.create(Error.prototype)", "Object.create(Map.prototype)", "Object.setPrototypeOf(new Date(0), null)", 'Object.setPrototypeOf(new Dog("x"), Object.prototype)',
  "(function () { return arguments; })()", "globalThis", "Math", "JSON", "Array.prototype", "Date.prototype", "Error.prototype", "Object.prototype", "Function.prototype",
];

const kindsOfTypeof = ["undefined", "object", "boolean", "number", "bigint", "string", "symbol", "function"];
const classes = ["Animal", "Dog", "Old", "Bound", "Even", "Stack", "Failure", "Object", "Function", "Array", "Date", "Error", "TypeError", "RegExp", "Map", "Set", "WeakMap", "Promise", "Uint8Array", "ArrayBuffer", "Number", "String", "Symbol"];
const tags = ["Array", "Object", "Function", "Date", "RegExp", "Error", "Null", "Undefined", "Number", "String", "Boolean", "Arguments", "Map", "Promise"];
const utilTests = ["isDate", "isRegExp", "isMap", "isSet", "isWeakMap", "isPromise", "isTypedArray", "isUint8Array", "isArrayBuffer", "isAnyArrayBuffer", "isDataView", "isNativeError", "isBoxedPrimitive", "isNumberObject", "isStringObject", "isProxy", "isGeneratorFunction", "isAsyncFunction", "isArgumentsObject"];

// X stands for the value.
const groups: Readonly<Record<string, readonly string[]>> = {
  "functions-that-ask-for-a-kind": [
    "Array.isArray(X)", "Error.isError(X)", "ArrayBuffer.isView(X)", "Buffer.isBuffer(X)",
    "Number.isInteger(X)", "Number.isSafeInteger(X)", "Number.isFinite(X)", "Number.isNaN(X)", "isNaN(X)", "isFinite(X)",
    "Boolean(X)", "!!X", "!X", "X === null", "X === undefined", "X == null", "X != null", "X !== X", "Object.is(X, -0)", "Object.is(X, NaN)", "X === Object(X)",
    "Array.isArray(X) && X.length > 0", "!Array.isArray(X)", "Number.isInteger(X) && X >= 0",
  ],
  "typeof": [
    ...kindsOfTypeof.map(kind => `typeof X === "${kind}"`),
    'typeof X !== "string"', 'typeof X == "number"', 'typeof X != "object"', '"function" === typeof X', 'typeof X === "nothing"', "typeof X",
    '(() => { switch (typeof X) { case "string": return "text"; case "number": return "number"; case "object": return "object"; case "function": return "function"; default: return "other"; } })()',
    '(() => { const kind = typeof X; return kind === "string" ? "text" : kind === "number" || kind === "bigint" ? "numeric" : kind === "object" ? "object" : kind; })()',
    'X && typeof X === "object"', 'X !== null && typeof X === "object"', 'typeof X === "object" && X !== null && !Array.isArray(X)', 'typeof X === "object" || typeof X === "function"',
    'typeof X === "number" && !isNaN(X)', 'typeof X === "string" || X instanceof String',
  ],
  "instanceof": [...classes.map(name => `X instanceof ${name}`), "X instanceof 5", "X instanceof {}", "X instanceof (() => {})", "!(X instanceof Error)", "X instanceof Dog || X instanceof Date"],
  "names-and-constructors": [
    '"name" in X', '"length" in X', "0 in X", "Symbol.iterator in X", 'Object.hasOwn(X, "name")', 'Object.hasOwn(X, "length")', 'X.hasOwnProperty("name")', 'Object.prototype.hasOwnProperty.call(X, "name")', 'Reflect.has(X, "name")',
    'typeof X.then === "function"', 'typeof X?.then === "function"', 'typeof X?.[Symbol.iterator] === "function"', "X?.constructor === Animal", "X?.constructor === Object", "X?.constructor === Array", "X?.constructor === Date", "X?.constructor?.name",
    "Object.getPrototypeOf(X) === Object.prototype", "Object.getPrototypeOf(X) === Array.prototype", "Object.getPrototypeOf(X) === null", "Animal.prototype.isPrototypeOf(X)", "Array.prototype.isPrototypeOf(X)",
  ],
  "the-tag-of-object-prototype-to-string": [
    "Object.prototype.toString.call(X)", "({}).toString.call(X)", "Object.prototype.toString.apply(X)",
    ...tags.map(tag => `Object.prototype.toString.call(X) === "[object ${tag}]"`),
    'Object.prototype.toString.call(X).slice(8, -1)', 'Object.prototype.toString.call(X) !== "[object Object]"',
  ],
  "the-tests-of-node-util": utilTests.map(name => `types.${name}(X)`),
};

const look = '`${typeof x} ${t(() => x.length)} ${t(() => x.name)} ${t(() => x.size)} ${t(() => x.message)} ${t(() => x.getTime)} ${t(() => typeof (x + 1))} ${t(() => x[0])}`';

const whySkipped = "a generated file of over a megabyte: a validating build of it takes over eight minutes and six gigabytes";
const options = JSON.stringify({ skipInShell: whySkipped, skipInVariant: { validate: whySkipped, "validate-back-end": whySkipped, "validate-collecting": whySkipped, validated: whySkipped } }, null, 2) + "\n";

for (const [group, predicates] of Object.entries(groups)) {
  const lines = [`// ${group.replaceAll("-", " ")}: each asked of each kind of value, where the compiler knows the value's type and where it does not, there with a look at the value behind the test. Written by ../generate-type-predicates.ts.`, prelude];
  for (const value of values) lines.push(`mix(${value});`);
  for (const predicate of predicates) {
    for (const value of values) {
      const label = JSON.stringify(`${predicate} | ${value}`);
      lines.push(`try { out(${label}, ${predicate.replaceAll("X", `(${value})`)}); } catch (error) { out(${label}, error.constructor.name); }`);
      lines.push(`try { const x = mix(${value}); if (${predicate.replaceAll("X", "x")}) out("  yes", ${look}); else out("  no", ${look}); } catch (error) { out("  neither", error.constructor.name); }`);
    }
  }
  written.push({ entry: `${group}.js`, files: { [`${group}.js`]: lines.join("\n") + "\n", [`${group}.json`]: options } });
}

export const programs = (): WrittenProgram[] => written;
