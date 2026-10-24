// An own data property of an instance of a built-in class (the length of an array, of a String object and of a function, the name of a function, lastIndex, message) answers for the object that holds it when it is found through an object that inherits from the instance. A store under the name defines a property of the heir and leaves the instance alone.
const kept = [];
console.log(Object.create(kept).length);
console.log(Object.create([1, 2, 3]).length);
console.log({ __proto__: [5] }.length);
class Bag extends Array {}
console.log(Object.create(new Bag(4)).length);
const twice = Object.create(Object.create([1, 2]));
console.log(twice.length, twice[1]);
console.log(Object.create(new String("abc")).length, Object.create(new String("abc"))[1]);
function named(a, b) { return a + b }
console.log(Object.create(named).length, Object.create(named).name);
const pattern = /a/g;
pattern.lastIndex = 3;
console.log(Object.create(pattern).lastIndex);
const failure = new Error("boom");
console.log(Object.create(failure).message);
console.log(Reflect.get([1, 2], "length", {}), Reflect.get([1, 2], "length", "text"), Reflect.get(named, "name", [1]));
const list = [1, 2, 3];
const heir = Object.create(list);
heir.length = 1;
console.log(heir.length, list.length, Object.keys(heir).length, list[2], Object.getOwnPropertyDescriptor(heir, "length").enumerable);
const grown = Object.create(list);
list.push(4);
console.log(grown.length, list.length);
const other = {};
console.log(Reflect.set(list, "length", 2, other), other.length, list.length);
const frozen = Object.create(Object.freeze([1, 2]));
try { frozen.length = 5; console.log("stored", frozen.length); } catch (error) { console.log(error instanceof TypeError, frozen.length); }
const heirOfPattern = Object.create(pattern);
heirOfPattern.lastIndex = 7;
console.log(heirOfPattern.lastIndex, pattern.lastIndex);
function lengthOf(value) { return value.length }
console.log(lengthOf(list), lengthOf(heir), lengthOf(grown), lengthOf("ab"), lengthOf(named), lengthOf(Object.create(named)));
function attempt(label, call) { try { console.log(label, call()); } catch (error) { console.log(label, error instanceof TypeError); } }
attempt("length of an heir of an array", () => Object.create([1]).length());
attempt("name of an heir of a function", () => Object.create(function named() {}).name());
attempt("lastIndex of an heir of a pattern", () => Object.create(/a/).lastIndex());
attempt("length of the array", () => [1].length());
const holder = /a/;
holder.lastIndex = function () { return this === heirOfHolder ? "called on the heir" : "called on another object"; };
const heirOfHolder = Object.create(holder);
console.log(heirOfHolder.lastIndex(), typeof heirOfHolder.lastIndex, holder.lastIndex === heirOfHolder.lastIndex);
console.log(Object.create(Array.prototype).length, Array.prototype.length);
function Old() {}
Old.prototype = [7, 8];
console.log(new Old().length, new Old()[1]);
console.log(Object.setPrototypeOf({}, [1, 2]).length);
console.log(Object.create(String.prototype).length, String.prototype.length);
console.log(Object.create(Function.prototype).length, JSON.stringify(Object.create(Function.prototype).name));
console.log(Object.create(RegExp.prototype).lastIndex, Object.create(Error.prototype).message === "", Object.create(Error.prototype).name);
class List extends Array { get size() { return this.length } }
console.log(Object.create(new List(3)).size, Object.create(List.prototype).length);
const typed = new Uint8Array(4);
try { console.log(Object.create(typed).length); } catch (error) { console.log(error.name); }
try { console.log(Object.create(new Map([[1, 2]])).size); } catch (error) { console.log(error.name); }
const args = (function () { return arguments })(1, 2, 3);
console.log(Object.create(args).length, Object.create(args)[2]);
const bound = function (a, b, c) {}.bind(null, 1);
console.log(Object.create(bound).length, Object.create(bound).name);
console.log(Object.create(class Named { static x = 1 }).name, Object.create(class Named { static x = 1 }).x);
console.log(Object.create(Object.create(Object.create("abc".split("")))).length);
