// In a compiled program every member that Math has at start-up is fixed, functions and constants alike, so Math.imul(a, b) is the multiplication in any program. Fixed too are the name Math of the global object, the prototype of Math, and the keys that a lookup must not find there: well-known symbols and the names of Object.prototype. Open are the four members that real packages replace: Math.random (libraries for seeded random numbers, tests), Math.sign (sylvester), Math.sinh (core-js 2) and Math.sumPrecise (core-js 3.37 to 3.39). A new name, an index and a symbol that the program made can be added, changed and deleted. language/math-member-write-stops-the-build has the store that stops the build.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

tryToChange("a function", Math, ["floor", "imul", "max", "sqrt", "hypot", "cosh"]);
tryToChange("a constant", Math, ["PI", "E", Symbol.toStringTag]);
tryToChange("a member that stays open", Math, ["random", "sign", "sinh", "sumPrecise"]);
tryToChange("a new name", Math, ["half", "clamp", "then", "toJSON", Symbol("mine"), Symbol.for("shared")]);
tryToChange("an index", Math, indexLikeKeys);
tryToChange("a key that stays absent", Math, ["toString", "valueOf", "hasOwnProperty", "constructor", ...wellKnownSymbols.filter(symbol => symbol !== Symbol.toStringTag)]);
tryToChange("the name of the global object", globalThis, ["Math"]);
tryToChangePrototype("Math", Math);

function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
const math = Math;
console.log("a store to the free name: " + [attempt(() => { Math = {}; return "done"; }), Math === math].join(" "));
Reflect.set(globalThis, "Math", math);

const original = Math.random;
Math.random = () => 0.25;
function roll(sides) { return Math.floor(Math.random() * sides); }
console.log("with another Math.random: " + [Math.random(), roll(8), roll(100)].join(" "));
Math.random = original;
console.log("and with the original again: " + [Math.random === original, roll(6) < 6].join(" "));

Math.half = n => n / 2;
Math[1] = 5;
console.log("what the program added: " + [Math.half(9), Math[1], 1 in Math, Object.keys(Math).join(), Math.imul(Math.half(6), 5), Math.floor(Math.half(7)), Math.PI > 3.14].join(" "));
console.log("and removed: " + [delete Math[1], delete Math.half, Math[1], Object.keys(Math).length].join(" "));
