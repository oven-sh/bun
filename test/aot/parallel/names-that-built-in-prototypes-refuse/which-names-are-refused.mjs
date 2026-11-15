const unseen = (x) => [x][JSON.parse("0")];
const holders = { Array: Array.prototype, Map: Map.prototype, Set: Set.prototype, WeakMap: WeakMap.prototype, String: String.prototype, Number: Number.prototype, Boolean: Boolean.prototype, BigInt: BigInt.prototype, Symbol: Symbol.prototype, Promise: Promise.prototype, RegExp: RegExp.prototype, Date: Date.prototype, Error: Error.prototype, Uint8Array: Uint8Array.prototype, ArrayBuffer: ArrayBuffer.prototype };
const names = ["last", "toJSON", "then", "valueOf", "toString", "toLocaleString", "constructor", "length", "inspect", Symbol.toPrimitive, Symbol.toStringTag, Symbol.isConcatSpreadable, Symbol.asyncIterator, Symbol.iterator, Symbol.hasInstance, Symbol.species, Symbol.unscopables, Symbol.dispose, Symbol.for("nodejs.util.inspect.custom"), Symbol("own")];
for (const name of names) {
  const refused = [], had = [];
  for (const [label, holder] of Object.entries(holders)) {
    if (Object.hasOwn(holder, name)) { had.push(label); continue; }
    try { Object.defineProperty(unseen(holder), unseen(name), { value: 1, configurable: true, writable: true }); delete holder[name]; } catch (error) { refused.push(label); }
  }
  console.log(String(name) + ": refused on: " + (refused.join(" ") || "none") + " | has it: " + (had.join(" ") || "none"));
}
/* Output:
last: refused on: none | has it: none
toJSON: refused on: Array WeakMap Promise RegExp Uint8Array ArrayBuffer | has it: Date
then: refused on: Array Map Set WeakMap RegExp Date Uint8Array ArrayBuffer | has it: Promise
valueOf: refused on: Array Map Set WeakMap Promise RegExp Uint8Array ArrayBuffer | has it: String Number Boolean BigInt Symbol Date
toString: refused on: Map Set WeakMap Promise Uint8Array ArrayBuffer | has it: Array String Number Boolean BigInt Symbol RegExp Date Error
toLocaleString: refused on: Map Set WeakMap String Boolean Symbol Promise RegExp Uint8Array ArrayBuffer | has it: Array Number BigInt Date
constructor: refused on: none | has it: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Error Uint8Array ArrayBuffer
length: refused on: Uint8Array | has it: Array String
inspect: refused on: none | has it: none
Symbol(Symbol.toPrimitive): refused on: Array Map Set WeakMap String Number Boolean BigInt Promise RegExp Uint8Array ArrayBuffer | has it: Symbol Date
Symbol(Symbol.toStringTag): refused on: Array String Number Boolean RegExp Date Uint8Array | has it: Map Set WeakMap BigInt Symbol Promise ArrayBuffer
Symbol(Symbol.isConcatSpreadable): refused on: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: none
Symbol(Symbol.asyncIterator): refused on: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: none
Symbol(Symbol.iterator): refused on: WeakMap Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: Array Map Set String
Symbol(Symbol.hasInstance): refused on: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: none
Symbol(Symbol.species): refused on: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: none
Symbol(Symbol.unscopables): refused on: Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: Array
Symbol(Symbol.dispose): refused on: Array Map Set WeakMap String Number Boolean BigInt Symbol Promise RegExp Date Uint8Array ArrayBuffer | has it: none
Symbol(nodejs.util.inspect.custom): refused on: none | has it: none
Symbol(own): refused on: none | has it: none
*/
