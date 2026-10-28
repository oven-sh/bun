// An async function, a generator function and an async generator function each inherit from a prototype of their own kind, which stands between the function and Function.prototype. In a compiled program these three are treated as Function.prototype is: every string key and every well-known symbol is fixed, whether it is there or not, and the prototype stays, so `f.call`, `f.name` and `f.prototype` are found where the language puts them. Only a symbol the program made can be added. The objects that generators themselves inherit from, with next, return and throw, are closed entirely. A function keeps taking properties of its own.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const kinds = [
  ["async functions", Object.getPrototypeOf(async function () {}), ["constructor", Symbol.toStringTag]],
  ["generator functions", Object.getPrototypeOf(function* () {}), ["constructor", "prototype", Symbol.toStringTag]],
  ["async generator functions", Object.getPrototypeOf(async function* () {}), ["constructor", "prototype", Symbol.toStringTag]],
];
for (const [name, prototype, members] of kinds) {
  tryToChange("the prototype of " + name + ": a member", prototype, members);
  tryToChange("the prototype of " + name + ": a new key", prototype, ["addedByTheProgram", "call", "apply", "bind", "toString", "name", "length", "then", "toJSON", "demethodize", ...indexLikeKeys, ...wellKnownSymbols.filter(symbol => symbol !== Symbol.toStringTag)]);
  tryToChange("the prototype of " + name + ": a symbol of the program", prototype, [Symbol("mine"), Symbol.for("shared")]);
  tryToChangePrototype("the prototype of " + name, prototype);
}

const generators = [
  ["generators", Object.getPrototypeOf(function* () {}).prototype],
  ["async generators", Object.getPrototypeOf(async function* () {}).prototype],
];
for (const [name, prototype] of generators) {
  tryToChange("the prototype of " + name + ": a member", prototype, ["next", "return", "throw", "constructor", Symbol.toStringTag]);
  tryToChange("the prototype of " + name + ": a new key", prototype, ["addedByTheProgram", "then", 0, Symbol.iterator, Symbol("mine")]);
  tryToChangePrototype("the prototype of " + name, prototype);
}

async function later() { return 1; }
function* counts() { yield 1; yield 2; }
later.label = "own";
later.call = () => "its own call";
counts.prototype.extra = function () { return "added to the generators of one function"; };
console.log("properties of the functions themselves: " + [later.label, later.call(), counts().extra(), [...counts()].join(), Function.prototype.call.call(counts).next().value].join(" | "));
console.log("what they are: " + [Object.prototype.toString.call(Object.getPrototypeOf(later)), Object.prototype.toString.call(counts), Object.getPrototypeOf(counts).prototype === Object.getPrototypeOf(counts.prototype), await later()].join(" | "));
