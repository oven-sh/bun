// A compiled program locks Symbol.species on Array, Map, Set, RegExp, Promise, ArrayBuffer, SharedArrayBuffer and %TypedArray%, and a typed array class cannot get one of its own. Array and Map keep their other members too and take new names: language/static-members-are-locked. A subclass declares its own species, and an object can have a constructor of its own: both are honored.
import { tryToChange } from "../changes-to-builtins.js";

const TypedArray = Object.getPrototypeOf(Uint8Array);
for (const [name, constructor] of [["Array", Array], ["Map", Map], ["Set", Set], ["RegExp", RegExp], ["Promise", Promise], ["ArrayBuffer", ArrayBuffer], ["SharedArrayBuffer", SharedArrayBuffer], ["%TypedArray%", TypedArray], ["Uint8Array", Uint8Array], ["Float32Array", Float32Array]])
  tryToChange(name, constructor, [Symbol.species]);
tryToChange("Array", Array, ["of", "addedByTheProgram"]);
tryToChange("Map", Map, ["groupBy", "addedByTheProgram"]);

console.log("the getters answer with the receiver: " + [Array[Symbol.species] === Array, Map[Symbol.species] === Map, RegExp[Symbol.species] === RegExp, Promise[Symbol.species] === Promise, Uint8Array[Symbol.species] === Uint8Array, TypedArray[Symbol.species] === TypedArray].join(" "));

class Kept extends Array {}
class ToArray extends Array { static get [Symbol.species]() { return Array; } }
console.log("subclasses of Array: " + [new Kept(1, 2, 3).map(value => value) instanceof Kept, ToArray.from([1, 2]).map(value => value) instanceof ToArray, ToArray.from([1, 2]).filter(() => true).constructor.name, ToArray.from([1, 2]).concat([3]).constructor.name, [1, 2].map(value => value).constructor === Array].join(" "));

const list = [1, 2];
list.constructor = { [Symbol.species]: function () { return { length: 0, madeBy: "the-species-of-the-object" }; } };
console.log("an array with its own constructor: " + [list.map(value => value).madeBy, list.slice().madeBy, list.filter(() => true).madeBy].join(" "));

const reads = [];
class Splitter extends RegExp { static get [Symbol.species]() { reads.push("read"); return RegExp; } }
console.log("a subclass of RegExp: " + ["a-b".split(new Splitter("-")).join("|"), reads.join()].join(" "));

class KeptPromise extends Promise {}
class ToPromise extends Promise { static get [Symbol.species]() { return Promise; } }
console.log("subclasses of Promise: " + [KeptPromise.resolve(1).then(value => value) instanceof KeptPromise, ToPromise.resolve(1).then(value => value) instanceof ToPromise, await ToPromise.resolve(1).then(value => value + 1)].join(" "));
