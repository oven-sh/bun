// What stands behind a failed test for an always locked built-in is neither resolved nor loaded: nothing named never-loaded exists.
// A built-in that a package may replace is tested when the program runs, so its polyfill is part of the build.
// IR- path="[^"]*never-loaded
// IR+ path="[^"]*random-polyfill.cjs"

if (!Object.assign) Object.assign = require("./never-loaded-assign.cjs");
if (typeof Symbol !== "function" || typeof Symbol.iterator !== "symbol") require("./never-loaded-symbol.cjs");
var keys = Object.keys || require("./never-loaded-keys.cjs");
var from = typeof Array.from === "function" ? Array.from : require("./missing/never-loaded-from.cjs");
if (Reflect.ownKeys == null || !globalThis.Map) require("never-loaded-package");
var random = Math.random || require("./random-polyfill.cjs");

function shadowed(Object) { return Object.assign ? "has" : require("./shadowed-polyfill.cjs"); }
var evaluated = require("./name-declared-by-eval.cjs");

console.log(keys({ a: 1, b: 2 }).join() + " " + from("ab").join() + " " + typeof random());
console.log(shadowed({ assign: 1 }) + " " + shadowed({}) + " " + shadowed(Object));
console.log(evaluated("") + " " + evaluated("var Symbol = 1"));
console.log(typeof Object.assign + " " + typeof Math + " " + typeof Function.prototype + " " + typeof Symbol.asyncIterator + " " + !Array.isArray + " " + (JSON != null));
