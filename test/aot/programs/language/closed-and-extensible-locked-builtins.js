// The built-in objects that a compiled program closes entirely, one per line: no key can be stored, and the object is not extensible. Below them stand objects under the usual lock: a member cannot be stored, a new ordinary name can, and the object stays extensible; an index can be stored on a constructor and on a namespace object, and not on a prototype. Last come built-ins that are not locked, a member that real packages replace, and a class of the program: this program stores to them, and every store holds as in plain Bun. language/function-prototype-is-locked, language/regexp-prototype-is-locked and language/string-prototype-keeps-its-members with its neighbors have the other locked objects.
function store(object, key, value) {
  const had = Object.getOwnPropertyDescriptor(object, key);
  try { object[key] = value; } catch (e) { return e.name; }
  const stored = object[key] === value;
  if (had) Object.defineProperty(object, key, had); else delete object[key];
  return stored ? "stored" : "ignored";
}
function row(name, object, member) {
  console.log(name + ": a new name " + store(object, "addedByTheProgram", 1) + ", " + String(member) + " " + store(object, member, () => 1) + ", index 0 " + store(object, 0, 1) + ", extensible " + Object.isExtensible(object));
}
function* generator() {}
async function* asyncGenerator() {}
class Own { method() {} }
const prototypeOf = Object.getPrototypeOf;

console.log("closed entirely");
row("Object.prototype", Object.prototype, "hasOwnProperty");
row("Promise.prototype", Promise.prototype, "then");
row("the prototype of generators", prototypeOf(generator.prototype), "next");
row("the prototype of async generators", prototypeOf(asyncGenerator.prototype), "next");

console.log("members fixed, new names allowed");
row("Array.prototype", Array.prototype, "push");
row("Date.prototype", Date.prototype, "toJSON");
row("Promise", Promise, "resolve");
row("Symbol", Symbol, "for");
row("Array", Array, "from");
row("Object", Object, "keys");
row("Math", Math, "max");
row("JSON", JSON, "rawJSON");
row("Reflect", Reflect, "get");
row("the prototype of all iterators", prototypeOf(prototypeOf([][Symbol.iterator]())), Symbol.iterator);
row("the prototype of array iterators", prototypeOf([][Symbol.iterator]()), "next");
row("the prototype of map iterators", prototypeOf(new Map()[Symbol.iterator]()), "next");
row("the prototype of set iterators", prototypeOf(new Set()[Symbol.iterator]()), "next");
row("the prototype of string iterators", prototypeOf(""[Symbol.iterator]()), "next");
row("the prototype of regexp string iterators", prototypeOf("".matchAll(/a/g)), "next");
row("the prototype of iterator helpers", prototypeOf([][Symbol.iterator]().map(value => value)), "next");
row("the prototype of what Iterator.from wraps", prototypeOf(Iterator.from({ next() { return { done: true }; } })), "next");
row("the prototype of async iterators", prototypeOf(prototypeOf(asyncGenerator.prototype)), Symbol.asyncIterator);
console.log("globalThis.Symbol: " + store(globalThis, "Symbol", function () {}));
console.log("globalThis.Map: " + store(globalThis, "Map", function () {}));
console.log("globalThis.Math: " + store(globalThis, "Math", {}));

console.log("not locked");
row("Error.prototype", Error.prototype, "toString");
row("Error", Error, "captureStackTrace");
row("Intl", Intl, "getCanonicalLocales");
row("a generator function's own prototype", generator.prototype, "next");
row("a class of the program", Own.prototype, "method");
console.log("JSON.parse, a member that packages replace: " + store(JSON, "parse", () => 1));
console.log("Date.prototype.toString, a member that packages replace: " + store(Date.prototype, "toString", () => 1));
console.log("Date.prototype.next, a name that a package adds: " + store(Date.prototype, "next", () => 1));
console.log("globalThis.Date: " + store(globalThis, "Date", function () {}));
console.log("globalThis.Promise: " + store(globalThis, "Promise", function () {}));
export {};
