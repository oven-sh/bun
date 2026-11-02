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
/* Output:
closed entirely
Object.prototype: a new name TypeError, hasOwnProperty TypeError, index 0 TypeError, extensible false
Promise.prototype: a new name TypeError, then TypeError, index 0 TypeError, extensible false
the prototype of generators: a new name TypeError, next TypeError, index 0 TypeError, extensible false
the prototype of async generators: a new name TypeError, next TypeError, index 0 TypeError, extensible false
members fixed, new names allowed
Array.prototype: a new name stored, push TypeError, index 0 TypeError, extensible true
Date.prototype: a new name stored, toJSON TypeError, index 0 TypeError, extensible true
Promise: a new name stored, resolve TypeError, index 0 stored, extensible true
Symbol: a new name stored, for TypeError, index 0 stored, extensible true
Array: a new name stored, from TypeError, index 0 stored, extensible true
Object: a new name stored, keys TypeError, index 0 stored, extensible true
Math: a new name stored, max TypeError, index 0 stored, extensible true
JSON: a new name stored, rawJSON TypeError, index 0 stored, extensible true
Reflect: a new name stored, get TypeError, index 0 stored, extensible true
the prototype of all iterators: a new name stored, Symbol(Symbol.iterator) TypeError, index 0 TypeError, extensible true
the prototype of array iterators: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of map iterators: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of set iterators: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of string iterators: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of regexp string iterators: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of iterator helpers: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of what Iterator.from wraps: a new name stored, next TypeError, index 0 TypeError, extensible true
the prototype of async iterators: a new name stored, Symbol(Symbol.asyncIterator) TypeError, index 0 TypeError, extensible true
globalThis.Symbol: TypeError
globalThis.Map: TypeError
globalThis.Math: TypeError
not locked
Error.prototype: a new name stored, toString stored, index 0 stored, extensible true
Error: a new name stored, captureStackTrace stored, index 0 stored, extensible true
Intl: a new name stored, getCanonicalLocales stored, index 0 stored, extensible true
a generator function's own prototype: a new name stored, next stored, index 0 stored, extensible true
a class of the program: a new name stored, method stored, index 0 stored, extensible true
JSON.parse, a member that packages replace: stored
Date.prototype.toString, a member that packages replace: stored
Date.prototype.next, a name that a package adds: stored
globalThis.Date: stored
globalThis.Promise: stored
*/
