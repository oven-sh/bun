// A built-in function is one whoever implements it. Those that the library writes in JavaScript (map, forEach, Function.prototype.call, Reflect.get ..) never get a call, apply, bind or Symbol.hasInstance of their own
// in a compiled program, like the native ones. Every other name may be added, and they may get another prototype.
import { tryToChange, tryToChangePrototype } from "../changes-to-builtins.js";

const closed = ["call", "apply", "bind", Symbol.hasInstance];
const functions = { "Array.prototype.map": Array.prototype.map, "Array.prototype.forEach": Array.prototype.forEach, "Array.prototype.reduce": Array.prototype.reduce, "Array.from": Array.from, "Function.prototype.call": Function.prototype.call, "Function.prototype.apply": Function.prototype.apply, "Reflect.get": Reflect.get, "Reflect.apply": Reflect.apply, "Object.fromEntries": Object.fromEntries, "Map.prototype.forEach": Map.prototype.forEach, "Promise.try": Promise.try };
for (const [name, builtin] of Object.entries(functions)) {
  tryToChange(name, builtin, closed);
  tryToChange(name + ", another name", builtin, ["mine", "toString", "valueOf", "constructor", Symbol("mine"), Symbol.toPrimitive]);
  tryToChangePrototype(name, builtin);
}

// Through hands that no build can follow: the store is refused, and compiled code goes on finding the members of Function.prototype.
const attempt = run => { try { return String(run()); } catch (error) { return error.name; } };
const poke = (target, key, value) => { target[key] = value; };
const hidden = (holder, key) => globalThis[[holder, ""].join("")].prototype[key];
function planted() { return "planted ran"; }
function target() { return "the target ran"; }
const uses = [
  ["Function.prototype.call", () => hidden("Function", "call"), () => Function.prototype.call.call(target, null)],
  ["Function.prototype.apply", () => hidden("Function", "apply"), () => Function.prototype.apply.call(target, null, [])],
  ["Array.prototype.map", () => hidden("Array", "map"), () => Array.prototype.map.call([1, 2], x => x * 2)],
  ["Array.prototype.forEach", () => hidden("Array", "forEach"), () => { let sum = 0; Array.prototype.forEach.call([1, 2], x => { sum += x; }); return sum; }],
  ["Reflect.get", () => globalThis[["Ref", "lect"].join("")].get, () => Reflect.get.call(null, { a: 7 }, "a")],
];
for (const [name, find, use] of uses)
  console.log(name + ": " + [attempt(use), attempt(() => poke(find(), ["ca", "ll"].join(""), planted)), attempt(use), attempt(() => Object.assign(find(), { apply: planted })), attempt(() => Object.defineProperty(find(), "bind", { value: planted }) && "defined"), attempt(use)].join(" | "));
console.log("the text of a refusal: " + (() => { try { poke(hidden("Array", "map"), "call", planted); } catch (error) { return error.message.split(" (")[0]; } })());
console.log("and under the symbol: " + (() => { try { Object.defineProperty(hidden("Array", "map"), Symbol.hasInstance, { value: planted }); } catch (error) { return error.message.split(" (")[0]; } })());
