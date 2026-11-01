// A built-in function is one whoever implements it. Those that the library writes in JavaScript (map, forEach, Function.prototype.call, Reflect.get ..) never get a call, apply, bind or Symbol.hasInstance of their own
// in a compiled program, like the native ones. Every other name may be added, and they may get another prototype.
import { tryToChange, tryToChangePrototype } from "../../fixtures/changes-to-builtins.js";

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
/* Output:
Array.prototype.map: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.map: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.map, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.map: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Array.prototype.forEach: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.forEach: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.forEach, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.forEach: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Array.prototype.reduce: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.reduce: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.reduce, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.reduce: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Array.from: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.from: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.from, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.from: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Function.prototype.call: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.call: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.call, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.call: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Function.prototype.apply: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.apply: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.apply, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Function.prototype.apply: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Reflect.get: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.get: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.get, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.get: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Reflect.apply: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.apply: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.apply, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Reflect.apply: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Object.fromEntries: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.fromEntries: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.fromEntries, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.fromEntries: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Map.prototype.forEach: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Map.prototype.forEach: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Map.prototype.forEach, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Map.prototype.forEach: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Promise.try: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Promise.try: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Promise.try, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Promise.try: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Function.prototype.call: the target ran | TypeError | the target ran | TypeError | TypeError | the target ran
Function.prototype.apply: the target ran | TypeError | the target ran | TypeError | TypeError | the target ran
Array.prototype.map: 2,4 | TypeError | 2,4 | TypeError | TypeError | 2,4
Array.prototype.forEach: 3 | TypeError | 3 | TypeError | TypeError | 3
Reflect.get: 7 | TypeError | 7 | TypeError | TypeError | 7
the text of a refusal: Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
and under the symbol: Cannot assign to [Symbol.hasInstance] of a built-in function because built-in objects are read-only in a compiled executable
*/
