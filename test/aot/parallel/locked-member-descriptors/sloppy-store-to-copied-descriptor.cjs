// Sloppy code throughout (a CommonJS file without "use strict", no class bodies). Descriptors of built-ins are copied onto the program's own objects, and then a member of the copy is assigned.
function Bag() { this.length = 0; }
Reflect.ownKeys(Array.prototype).forEach(function (key) {
  if (key !== "constructor") Object.defineProperty(Bag.prototype, key, Object.getOwnPropertyDescriptor(Array.prototype, key));
});
function mine() { return "mine"; }
Bag.prototype.push = mine;
var bag = new Bag();
bag.join = mine;
console.log("one by one:", Bag.prototype.push === mine ? "the store took" : "THE STORE WAS IGNORED", bag.join === mine ? "the store took" : "THE STORE WAS IGNORED");
var math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
math.floor = mine;
console.log("all at once:", math.floor === mine ? "the store took" : "THE STORE WAS IGNORED");
var made = Object.create(null, Object.getOwnPropertyDescriptors(Reflect));
made.get = mine;
console.log("Object.create:", made.get === mine ? "the store took" : "THE STORE WAS IGNORED");
var spread = Object.defineProperty({}, "keys", Object.assign({}, Object.getOwnPropertyDescriptor(Object, "keys")));
spread.keys = mine;
console.log("a copy of the descriptor:", spread.keys === mine ? "the store took" : "THE STORE WAS IGNORED");
