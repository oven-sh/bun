// The names that the language asks an object for by itself: `then` of what is awaited, `toJSON` of what JSON.stringify writes, `next`, `return` and `throw` of what Symbol.iterator answers.
// A built-in prototype whose members a compiled program fixes takes none of them, with the exceptions that the rows show. Every other new name is stored.
function store(object, key) {
  const value = () => 1;
  const had = Object.getOwnPropertyDescriptor(object, key);
  try { object[key] = value; } catch (e) { return e.name; }
  const stored = object[key] === value;
  if (had) Object.defineProperty(object, key, had); else delete object[key];
  return stored ? "stored" : "ignored";
}
function row(name, object) {
  const answers = ["then", "toJSON", "next", "return", "throw", "addedByTheProgram"].map(key => key + " " + store(object, key));
  console.log(name + ": " + answers.join(", "));
}
const prototypeOf = Object.getPrototypeOf;

console.log("instances are objects");
row("Array.prototype", Array.prototype);
row("Map.prototype", Map.prototype);
row("Set.prototype", Set.prototype);
row("WeakMap.prototype", WeakMap.prototype);
row("WeakSet.prototype", WeakSet.prototype);
row("ArrayBuffer.prototype", ArrayBuffer.prototype);
row("SharedArrayBuffer.prototype", SharedArrayBuffer.prototype);
row("DataView.prototype", DataView.prototype);
row("the prototype of all typed arrays", prototypeOf(Uint8Array.prototype));
row("Uint8Array.prototype", Uint8Array.prototype);
row("Float64Array.prototype", Float64Array.prototype);
row("Buffer.prototype", Buffer.prototype);
row("Iterator.prototype", Iterator.prototype);
row("Date.prototype", Date.prototype);

console.log("instances are primitives");
row("String.prototype", String.prototype);
row("Number.prototype", Number.prototype);
row("Boolean.prototype", Boolean.prototype);
row("BigInt.prototype", BigInt.prototype);
row("Symbol.prototype", Symbol.prototype);

console.log("not locked");
row("WeakRef.prototype", WeakRef.prototype);
row("Error.prototype", Error.prototype);
row("RangeError.prototype", RangeError.prototype);
row("a class of the program", class Own {}.prototype);
row("a class of the program below Array", class List extends Array {}.prototype);

console.log("text that is evaluated at run time is refused like the program");
const glue = (first, second) => [first, second].join(process.argv.length > 99 ? "x" : "");
const evaluate = text => { try { return String(new Function(glue(text, ""))()); } catch (error) { return error.name; } };
console.log("strict:", evaluate(`"use strict"; Array.prototype.next = function () {};`));
console.log("sloppy:", evaluate(`Array.prototype.next = function () {}; return typeof Array.prototype.next;`));
console.log("Reflect.set:", evaluate(`return Reflect.set(Array.prototype, "return", 1);`));
console.log("Object.defineProperty:", evaluate(`Object.defineProperty(Set.prototype, "throw", { value: 1 });`));
export {};
/* Output:
instances are objects
Array.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Map.prototype: then TypeError, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Set.prototype: then TypeError, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
WeakMap.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
WeakSet.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
ArrayBuffer.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
SharedArrayBuffer.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
DataView.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
the prototype of all typed arrays: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Uint8Array.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Float64Array.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Buffer.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Iterator.prototype: then TypeError, toJSON TypeError, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Date.prototype: then TypeError, toJSON TypeError, next stored, return TypeError, throw TypeError, addedByTheProgram stored
instances are primitives
String.prototype: then stored, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Number.prototype: then stored, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Boolean.prototype: then stored, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
BigInt.prototype: then stored, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
Symbol.prototype: then stored, toJSON stored, next TypeError, return TypeError, throw TypeError, addedByTheProgram stored
not locked
WeakRef.prototype: then stored, toJSON stored, next stored, return stored, throw stored, addedByTheProgram stored
Error.prototype: then stored, toJSON stored, next stored, return stored, throw stored, addedByTheProgram stored
RangeError.prototype: then stored, toJSON stored, next stored, return stored, throw stored, addedByTheProgram stored
a class of the program: then stored, toJSON stored, next stored, return stored, throw stored, addedByTheProgram stored
a class of the program below Array: then stored, toJSON stored, next stored, return stored, throw stored, addedByTheProgram stored
text that is evaluated at run time is refused like the program
strict: TypeError
sloppy: TypeError
Reflect.set: false
Object.defineProperty: TypeError
*/
