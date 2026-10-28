// A compiled program locks every member that these have at the start: the prototypes of ArrayBuffer, SharedArrayBuffer and DataView, and both the constructor and the prototype of %TypedArray%, of every typed array class and of Buffer, but for four functions that core-js/full replaces: Uint8Array.fromBase64 and fromHex, Uint8Array.prototype.toBase64 and toHex. core-js 2 defines toLocaleString on each typed array class, so that one inherited name is open there. The objects stay extensible for ordinary names, and the constructors for indexes too. The prototypes take no index-like key, and none of them takes a well-known symbol or a name that an object further up its chain has (a new Uint8Array.prototype.subarray would replace the member for every Uint8Array), and the prototypes take no then and no toJSON. Their own prototypes stay. A subclass and a single object can still have members of their own, a species among them.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const TypedArray = Object.getPrototypeOf(Uint8Array);
const ofObjectPrototype = ["hasOwnProperty", "valueOf"];
const ofFunctionPrototype = ["call", "apply", "bind", "toString", ...ofObjectPrototype];
const ofTypedArrayPrototype = ["subarray", "map", "set", "length", "buffer", "toString", ...ofObjectPrototype];
const objects = [
  ["ArrayBuffer.prototype", ArrayBuffer.prototype, ["slice", "resize", "transfer", "byteLength", "constructor", Symbol.toStringTag], ["then", "toJSON", "toString", ...ofObjectPrototype]],
  ["SharedArrayBuffer.prototype", SharedArrayBuffer.prototype, ["slice", "grow", "byteLength", "constructor", Symbol.toStringTag], ["then", "toJSON", "toString", ...ofObjectPrototype]],
  ["DataView.prototype", DataView.prototype, ["getInt8", "setFloat64", "byteLength", "buffer", "constructor", Symbol.toStringTag], ["then", "toJSON", "toString", ...ofObjectPrototype]],
  ["%TypedArray%.prototype", TypedArray.prototype, ["subarray", "map", "set", "length", "buffer", "toString", "constructor", Symbol.iterator, Symbol.toStringTag], ["then", "toJSON", ...ofObjectPrototype]],
  ["Uint8Array.prototype", Uint8Array.prototype, ["BYTES_PER_ELEMENT", "constructor", "setFromHex", "setFromBase64"], ["then", "toJSON", ...ofTypedArrayPrototype]],
  ["Float64Array.prototype", Float64Array.prototype, ["BYTES_PER_ELEMENT", "constructor"], ["then", "toJSON", ...ofTypedArrayPrototype]],
  ["Buffer.prototype", Buffer.prototype, ["readInt8", "writeUInt8", "toString", "toJSON", "slice", "subarray", "equals", "constructor", Symbol.species, Symbol.toStringTag], ["then", "map", "set", "length", "buffer", "toHex", "BYTES_PER_ELEMENT", ...ofObjectPrototype]],
  ["%TypedArray%", TypedArray, ["from", "of", "prototype", Symbol.species], ofFunctionPrototype],
  ["Uint8Array", Uint8Array, ["BYTES_PER_ELEMENT", "prototype"], ["from", "of", ...ofFunctionPrototype]],
  ["BigInt64Array", BigInt64Array, ["BYTES_PER_ELEMENT", "prototype"], ["from", "of", ...ofFunctionPrototype]],
  ["Buffer", Buffer, ["from", "alloc", "concat", "isBuffer", "byteLength", "prototype"], ["of", "fromHex", "BYTES_PER_ELEMENT", ...ofFunctionPrototype]],
];
for (const [name, object, members, inherited] of objects) {
  tryToChange(name + ": a member", object, members);
  const isConstructor = typeof object === "function";
  tryToChange(name + ": a key it is closed for", object, [...inherited, ...(isConstructor ? [] : indexLikeKeys), ...wellKnownSymbols.filter(symbol => !members.includes(symbol))]);
  tryToChange(name + ": any other key", object, ["addedByTheProgram", ...(isConstructor ? indexLikeKeys : []), Symbol("mine")]);
  tryToChangePrototype(name, object);
}

tryToChange("what core-js/full replaces", Uint8Array, ["fromHex", "fromBase64"]);
tryToChange("what core-js/full replaces", Uint8Array.prototype, ["toHex", "toBase64"]);
tryToChange("the inherited name that core-js 2 defines on a typed array class", Int8Array, ["toLocaleString"]);

const poolSize = Buffer.poolSize;
Buffer.poolSize = 4096;
console.log("Buffer.poolSize is no part of the lock: " + Buffer.poolSize);
Buffer.poolSize = poolSize;

Uint8Array.prototype.sum = function () { let total = 0; for (const byte of this) total += byte; return total; };
Buffer.prototype.firstByte = function () { return this[0]; };
Uint8Array.zeros = function (length) { return new this(length); };
console.log("what the program added: " + [new Uint8Array([1, 2, 3]).sum(), Buffer.from([4, 5]).sum(), Buffer.from([4, 5]).firstByte(), Uint8Array.zeros(2).join()].join(" "));
delete Uint8Array.prototype.sum;
delete Buffer.prototype.firstByte;
delete Uint8Array.zeros;

class Words extends Uint8Array {
  static get [Symbol.species]() { return Uint16Array; }
  subarray() { return "its own subarray"; }
}
const words = new Words([1, 2, 3]);
console.log("a subclass with its own species and subarray: " + [words.map(byte => byte * 300).constructor.name, words.map(byte => byte * 300).join(), words.slice(1).constructor.name, words.filter(() => true) instanceof Uint16Array, words.subarray(1)].join(" "));

const bytes = new Uint8Array([1, 2]);
bytes.constructor = { [Symbol.species]: Float64Array };
console.log("an object with its own constructor: " + [bytes.map(byte => byte / 2).join(), bytes.map(byte => byte).constructor.name].join(" "));

class Chunk extends ArrayBuffer { static get [Symbol.species]() { return ArrayBuffer; } }
console.log("a subclass of ArrayBuffer with its own species: " + [new Chunk(8).slice(4) instanceof Chunk, new Chunk(8).slice(4).byteLength].join(" "));

function elementOf(array, key) { return array[key]; }
console.log("elements outside: " + [5, -1, 1.5, "5", "-1", "1.5", "NaN"].map(key => String(elementOf(new Uint8Array(2), key))).join(" "));
console.log("the members: " + [new Uint8Array([1, 2, 3]).subarray(1).constructor.name, new Uint8Array([1, 2, 3]).map(byte => byte * 2).join(), new Float64Array([1.5]).slice().constructor.name, Uint8Array.from([1, 2]).length, Buffer.from("hi").toString("hex"), Buffer.from([1, 2, 3]).subarray(1) instanceof Buffer, Buffer.from([1, 2, 3]).readInt8(2), new DataView(new ArrayBuffer(8)).getInt8(0), new ArrayBuffer(8).slice(2).byteLength, Object.prototype.toString.call(new Int8Array(1)), JSON.stringify(new Uint8Array([7]))].join(" "));
