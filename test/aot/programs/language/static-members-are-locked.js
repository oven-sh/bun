// In a compiled program the static members that a built-in constructor or namespace has at start-up are fixed, and so is its name on the global object, so Object.keys(o), Array.isArray(x) and Number.isInteger(n) are the built-ins in any program. What real packages replace stays open, by name: JSON.parse (spies), Object.getOwnPropertyNames (the package private), Number.parseInt (core-js 2), Date.now and Date itself (fake timers), Promise (bluebird), all of Intl (@formatjs) and of Error (stack traces). An ordinary new name can be added everywhere, as reflect-metadata does. language/math-is-locked has Math.
import { tryToChange, tryToChangePrototype } from "../changes-to-builtins.js";

tryToChange("Object", Object, ["keys", "assign", "create", "defineProperty", "freeze", "entries", "name", "length"]);
tryToChange("Array", Array, ["isArray", "from", "of", Symbol.species]);
tryToChange("Number", Number, ["isInteger", "isFinite", "isNaN", "isSafeInteger"]);
tryToChange("String", String, ["fromCharCode", "fromCodePoint", "raw"]);
tryToChange("BigInt", BigInt, ["asIntN", "asUintN"]);
tryToChange("Reflect", Reflect, ["get", "set", "apply", "ownKeys", "defineProperty"]);
tryToChange("Atomics", Atomics, ["add", "load", "store"]);
tryToChange("JSON", JSON, ["rawJSON", "isRawJSON"]);
tryToChange("ArrayBuffer", ArrayBuffer, ["isView"]);
tryToChange("Date", Date, ["UTC"]);
tryToChange("Proxy", Proxy, ["revocable"]);
tryToChange("a name of the global object", globalThis, ["Object", "Array", "Number", "String", "Boolean", "BigInt", "Map", "Set", "WeakSet", "ArrayBuffer", "Uint8Array", "Float64Array", "RegExp", "Proxy", "JSON", "Reflect", "Atomics"]);
tryToChange("an inherited name", Object, ["call", "apply", "bind", "toString", "hasOwnProperty"]);
tryToChangePrototype("Object", Object);
tryToChangePrototype("Reflect", Reflect);

tryToChange("what packages replace", JSON, ["parse", "stringify"]);
tryToChange("what a package replaces and is locked all the same", Object, ["getOwnPropertyNames"]);
tryToChange("what packages replace", Number, ["parseFloat", "parseInt"]);
tryToChange("what packages replace", Date, ["now", "parse"]);
tryToChange("what packages replace", Promise, ["try"]);
tryToChange("what packages replace", Map, ["groupBy"]);
tryToChange("what packages replace", RegExp, ["escape"]);
tryToChange("what packages replace", Error, ["captureStackTrace", "stackTraceLimit", "prepareStackTrace", "isError"]);
tryToChange("what packages replace", Intl, ["NumberFormat", "DateTimeFormat", "PluralRules", "getCanonicalLocales"]);
tryToChange("what packages replace", globalThis, ["Date", "Intl", "Promise", "WeakMap", "Error", "TypeError"]);
tryToChange("a new name", Object, ["mine", Symbol("mine")]);
tryToChange("a new name", Reflect, ["defineMetadata", "getMetadata", Symbol.for("@reflect-metadata:registry")]);
tryToChange("a new name", Array, ["range"]);
tryToChange("a new name", JSON, ["safeParse"]);

const parse = JSON.parse;
JSON.parse = text => ["wrapped", parse(text)];
console.log("with another JSON.parse: " + JSON.stringify(JSON.parse("[1]")));
JSON.parse = parse;
class FakeDate extends Date { static now() { return 1000; } }
const RealDate = Date;
globalThis.Date = FakeDate;
console.log("with another Date: " + [Date.now(), new Date(5).getTime(), Date === FakeDate].join(" "));
globalThis.Date = RealDate;
console.log("and after all that: " + [Object.keys({ a: 1 }).join(), Array.isArray([]), Number.isInteger(5), String.fromCharCode(65), Reflect.get({ a: 2 }, "a"), JSON.parse("3"), Date === RealDate].join(" "));
