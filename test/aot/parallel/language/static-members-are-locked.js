// In a compiled program the static members that a built-in constructor or namespace has at start-up are fixed, and so is its name on the global object, so Object.keys(o), Array.isArray(x) and Number.isInteger(n) are the built-ins in any program. What real packages replace stays open, by name: JSON.parse (spies), Object.getOwnPropertyNames (the package private), Number.parseInt (core-js 2), Date.now and Date itself (fake timers), Promise (bluebird), all of Intl (@formatjs) and of Error (stack traces). An ordinary new name can be added everywhere, as reflect-metadata does. language/math-is-locked has Math.
import { tryToChange, tryToChangePrototype } from "../../fixtures/changes-to-builtins.js";

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
/* Output:
Object: keys assign create defineProperty freeze entries: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Object: name length: store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Array: isArray from of: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Array: Symbol(Symbol.species): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Number: isInteger isFinite isNaN isSafeInteger: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
String: fromCharCode fromCodePoint raw: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
BigInt: asIntN asUintN: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Reflect: get set apply ownKeys defineProperty: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Atomics: add load store: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
JSON: rawJSON isRawJSON: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
ArrayBuffer: isView: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Date: UTC: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
Proxy: revocable: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
a name of the global object: Object Array Number String Boolean BigInt Map Set WeakSet ArrayBuffer Uint8Array Float64Array RegExp Proxy JSON Reflect Atomics: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
an inherited name: call apply bind toString hasOwnProperty: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Reflect: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
what packages replace: parse stringify: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what a package replaces and is locked all the same: getOwnPropertyNames: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete TypeError/unchanged, sloppy delete TypeError/unchanged, Reflect.deleteProperty false/unchanged
what packages replace: parseFloat parseInt: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: now parse: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: try: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: groupBy: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: escape: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: captureStackTrace stackTraceLimit prepareStackTrace isError: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: NumberFormat DateTimeFormat PluralRules getCanonicalLocales: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
what packages replace: Date Intl Promise WeakMap Error TypeError: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/changed, sloppy delete true/changed, Reflect.deleteProperty true/changed
a new name: mine Symbol(mine): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
a new name: defineMetadata getMetadata Symbol(@reflect-metadata:registry): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
a new name: range: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
a new name: safeParse: store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
with another JSON.parse: ["wrapped",[1]]
with another Date: 1000 5 true
and after all that: a true true A 2 3 true
*/
