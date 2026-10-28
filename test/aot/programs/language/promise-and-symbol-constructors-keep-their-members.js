// A compiled program locks the members that the constructors Promise and Symbol have at the start, so Promise.resolve is the original and a well-known symbol is a constant key. Both stay extensible for ordinary names, for indexes and for symbols that the program made. They take no well-known symbol and no name of Function.prototype or Object.prototype, and their prototypes stay. Promise.prototype is closed entirely.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const inheritedNames = ["call", "apply", "bind", "toString", "constructor", "hasOwnProperty", "valueOf"];
const constructors = [
  ["Promise", Promise, ["all", "allSettled", "any", "race", "reject", "resolve", "try", "withResolvers", "prototype", Symbol.species], ["allKeyed"]],
  ["Symbol", Symbol, ["for", "keyFor", "iterator", "asyncIterator", "hasInstance", "toPrimitive", "species", "unscopables", "prototype"], ["observable", "metadata", "useSetter"]],
];
for (const [name, constructor, members, openNames] of constructors) {
  tryToChange(name + ": a member", constructor, members);
  tryToChange(name + ": a key it is closed for", constructor, [...wellKnownSymbols.filter(symbol => !Object.hasOwn(constructor, symbol)), ...inheritedNames]);
  tryToChange(name + ": any other key", constructor, ["addedByTheProgram", ...openNames, "then", "toJSON", ...indexLikeKeys, Symbol("mine"), Symbol.for("shared")]);
  tryToChangePrototype(name, constructor);
}
tryToChange("Promise.prototype: a member", Promise.prototype, ["then", "catch", "finally", "constructor", Symbol.toStringTag]);
tryToChange("Promise.prototype: a new key", Promise.prototype, ["addedByTheProgram", "toJSON", 0, Symbol.iterator, Symbol("mine"), Symbol.for("shared")]);

Promise.allKeyed = async function (promises) {
  const result = {};
  for (const key of Object.keys(promises)) result[key] = await promises[key];
  return result;
};
Symbol.observable = Symbol("observable");
const source = { [Symbol.observable]() { return "observed"; } };
console.log("what the program added: " + [JSON.stringify(await Promise.allKeyed({ a: Promise.resolve(1), b: 2 })), source[Symbol.observable](), String(Symbol.observable), typeof Symbol.observable].join(" "));
delete Promise.allKeyed;
delete Symbol.observable;
console.log("and removed: " + [typeof Promise.allKeyed, typeof Symbol.observable].join(" "));

class Later extends Promise { static resolve(value) { return super.resolve("its own resolve " + value); } }
console.log("a subclass with its own resolve: " + [await Later.resolve(1), Later.resolve(1) instanceof Later, await Later.all([1, 2]).then(values => values.join("|"))].join(" "));
console.log("the members: " + [(await Promise.all([1, Promise.resolve(2)])).join(), await Promise.race([3, 4]), await Promise.any([Promise.reject(5), 6]), (await Promise.allSettled([Promise.reject(7)]))[0].status, Symbol.for("a") === Symbol.for("a"), Symbol.keyFor(Symbol.for("a")), [][Symbol.iterator] === [].values].join(" "));
