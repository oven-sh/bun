// The descriptor of Buffer.concat says writable: false in an executable, so a property that is defined from it is read-only: a store to the copy is ignored in sloppy code and throws in strict code.
// A copy of the value, and an object that inherits from Buffer, take the store.
function mine() { return "mine"; }
function took(object) { return object.concat === mine ? "the store took" : "the store was ignored"; }
var copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Buffer));
copy.concat = mine;
copy.from = mine;
console.log("sloppy, a copy of the descriptors:", took(copy), copy.from === mine);
console.log("strict, a copy of the descriptors:", (function () {
  "use strict";
  try { copy.concat = mine; return took(copy); } catch (error) { return error.constructor.name; }
})());
var values = Object.assign({}, Buffer, { concat: Buffer.concat });
values.concat = mine;
console.log("a copy of the value:", took(values));
var heir = Object.create(Buffer);
heir.concat = mine;
console.log("an object that inherits:", took(heir));
function Child() {}
Object.setPrototypeOf(Child, Buffer);
Child.concat = mine;
console.log("a constructor that inherits:", took(Child), Buffer.concat !== mine);
/* Output:
sloppy, a copy of the descriptors: the store was ignored true
strict, a copy of the descriptors: TypeError
a copy of the value: the store took
an object that inherits: the store took
a constructor that inherits: the store took true
*/
