// What require of an es module hands out.
const { attempt } = require("./show.cjs");
const required = require("./point.mjs");
const imported = require("./imports.mjs").point;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

attempt("the same object as the namespace", () => required === imported);
for (const [name, value] of Object.entries({ required, imported })) {
  attempt(name + " is frozen, sealed, extensible", () => [Object.isFrozen(value), Object.isSealed(value), Object.isExtensible(value)]);
  attempt(name + " keys", () => Reflect.ownKeys(value).map(String));
  attempt(name + " prototype", () => Object.getPrototypeOf(value));
  attempt(name + " tag", () => Object.prototype.toString.call(value));
  attempt(name + " marked as an ES module", () => [value.__esModule, "__esModule" in value]);
  attempt(name + " can be closed", () => Reflect.preventExtensions(value));
  attempt(name + " takes a new member", () => Reflect.set(value, "z", 3));
}
/* Output:
this file is strict: false
the same object as the namespace true
required is frozen, sealed, extensible Array[false, true, false]
required keys Array["default", "x", "y", "Symbol(Symbol.toStringTag)"]
required prototype no-prototype{__esModule: accessor}
required tag "[object Module]"
required marked as an ES module Array[true, true]
required can be closed true
required takes a new member false
imported is frozen, sealed, extensible Array[false, true, false]
imported keys Array["default", "x", "y", "Symbol(Symbol.toStringTag)"]
imported prototype no-prototype{__esModule: accessor}
imported tag "[object Module]"
imported marked as an ES module Array[true, true]
imported can be closed true
imported takes a new member false
*/
