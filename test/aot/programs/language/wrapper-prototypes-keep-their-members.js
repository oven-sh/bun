// A compiled program locks every member that the prototypes of Number, Boolean, BigInt and Symbol have at the start. The objects stay extensible for ordinary names, toJSON among them, and a primitive finds what was added. They take no index-like key, no well-known symbol and no name of Object.prototype, and their prototypes stay.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const wrappers = [
  ["Number.prototype", Number.prototype, ["toFixed", "toString", "toLocaleString", "toPrecision", "valueOf", "constructor"]],
  ["Boolean.prototype", Boolean.prototype, ["toString", "valueOf", "constructor"]],
  ["BigInt.prototype", BigInt.prototype, ["toString", "toLocaleString", "valueOf", "constructor", Symbol.toStringTag]],
  ["Symbol.prototype", Symbol.prototype, ["toString", "valueOf", "description", "constructor", Symbol.toPrimitive, Symbol.toStringTag]],
];
for (const [name, prototype, members] of wrappers) {
  tryToChange(name + ": a member", prototype, members);
  tryToChange(name + ": a key it is closed for", prototype, [...indexLikeKeys, ...wellKnownSymbols.filter(symbol => !members.includes(symbol)), "hasOwnProperty", "isPrototypeOf"]);
  tryToChange(name + ": any other key", prototype, ["addedByTheProgram", "then", "toJSON", "length", Symbol("mine")]);
  tryToChangePrototype(name, prototype);
}

Number.prototype.doubled = function () { return this * 2; };
Object.defineProperty(Boolean.prototype, "negated", { get() { return !this.valueOf(); }, configurable: true });
BigInt.prototype.toJSON = function () { return this.toString() + "n"; };
Symbol.prototype.named = function () { return "<" + this.description + ">"; };
console.log("what the program added: " + [(21).doubled(), (1.5).doubled(), true.negated, JSON.stringify({ big: 10n, list: [1n] }), Symbol("s").named()].join(" "));
delete Number.prototype.doubled;
delete Boolean.prototype.negated;
delete BigInt.prototype.toJSON;
delete Symbol.prototype.named;

const reads = [];
Object.defineProperty(Number.prototype, "length", { get() { reads.push("length of " + this); return 0; }, configurable: true });
console.log("a getter that a built-in reads on a number: " + ["a".localeCompare("b", 5), Array.from(7).length, Array.prototype.slice.call(8).length, reads.join()].join(" "));
delete Number.prototype.length;

console.log("the members: " + [(255).toString(16), (1.005).toFixed(1), [1234.5, 2].toLocaleString("en-US"), 1 + new Number(1), `${new Boolean(false)}`, (2n ** 64n).toString(), Symbol("d").description, Symbol("d").toString(), Object.prototype.toString.call(1n), Object.prototype.toString.call(1)].join(" "));
