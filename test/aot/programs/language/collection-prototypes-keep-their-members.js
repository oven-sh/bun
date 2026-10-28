// A compiled program locks the members that the prototypes of Map, Set, WeakMap and WeakSet have at the start, so a constructor adds what it is given with the original set or add. Only the methods of Set that take another set can be replaced, as packages do. The objects stay extensible for ordinary names. They take no index-like key, no well-known symbol, no then and no name of Object.prototype, the weak ones no toJSON either, and their prototypes stay. A subclass and a single object can still have members of their own.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const collections = [
  ["Map.prototype", Map.prototype, ["get", "set", "has", "delete", "clear", "forEach", "entries", "size", "constructor", Symbol.iterator, Symbol.toStringTag], ["toJSON"]],
  ["Set.prototype", Set.prototype, ["add", "has", "delete", "clear", "forEach", "values", "keys", "size", "constructor", Symbol.iterator, Symbol.toStringTag], ["toJSON"]],
  ["WeakMap.prototype", WeakMap.prototype, ["get", "set", "has", "delete", "constructor", Symbol.toStringTag], []],
  ["WeakSet.prototype", WeakSet.prototype, ["add", "has", "delete", "constructor", Symbol.toStringTag], []],
];
for (const [name, prototype, members, openNames] of collections) {
  tryToChange(name + ": a member", prototype, members);
  tryToChange(name + ": a key it is closed for", prototype, [...indexLikeKeys, ...wellKnownSymbols.filter(symbol => !members.includes(symbol)), "then", "toJSON", "toString", "valueOf", "hasOwnProperty"].filter(key => !openNames.includes(key)));
  tryToChange(name + ": any other key", prototype, ["addedByTheProgram", "length", ...openNames, Symbol("mine"), Symbol.for("shared")]);
  tryToChangePrototype(name, prototype);
}
tryToChange("Set.prototype: a member that packages replace", Set.prototype, ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]);

Map.prototype.mapValues = function (change) { return new Map([...this].map(([key, value]) => [key, change(value)])); };
Object.defineProperty(Set.prototype, "first", { get() { for (const value of this) return value; }, configurable: true });
console.log("what the program added: " + [[...new Map([["a", 1], ["b", 2]]).mapValues(value => value * 10).values()].join(), new Set([7, 8]).first].join(" "));
delete Map.prototype.mapValues;
delete Set.prototype.first;

Map.prototype.toJSON = function () { return [...this]; };
Set.prototype.toJSON = function () { return [...this]; };
console.log("toJSON of the program: " + JSON.stringify({ map: new Map([[1, 2]]), set: new Set([3]) }));
delete Map.prototype.toJSON;
delete Set.prototype.toJSON;

const calls = [];
class CountingSet extends Set { add(value) { calls.push("add " + value); return super.add(value); } }
class CountingMap extends Map { set(key, value) { calls.push("set " + key); return super.set(key, value); } }
class CountingWeakSet extends WeakSet { add(value) { calls.push("weak add"); return super.add(value); } }
console.log("a subclass with its own add or set: " + [new CountingSet([1, 2, 2]).size, new CountingMap([["a", 1], ["b", 2]]).size, new CountingWeakSet([{}]) instanceof WeakSet, calls.join()].join(" "));

const set = new Set([1]);
set.add = function () { return "its own add"; };
set.has = function () { return "its own has"; };
console.log("an object with its own members: " + [set.add(2), set.has(1), set.size, new Set(set).size, [...set].join()].join(" "));

const moved = new Map([["a", 1]]);
Object.setPrototypeOf(moved, { get() { return "another get"; }, __proto__: Map.prototype });
console.log("an object with another prototype: " + [moved.get("a"), moved.has("a"), moved.size, moved instanceof Map].join(" "));

function sum(values) { let total = 0; for (const value of values) total += value; return total; }
const key = {};
console.log("the members: " + [new Set([1, 2, 2, 3]).size, sum(new Set([1, 2, 2, 3])), new Map([[1, 2], [3, 4]]).get(3), sum(new Map([[1, 2], [3, 4]]).values()), new WeakMap([[key, 5]]).get(key), new WeakSet([key]).has(key), JSON.stringify(new Map([[1, 2]])), String(new Set()), (await Promise.resolve(new Map([[1, 2]]))).size].join(" "));
