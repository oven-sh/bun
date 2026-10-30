// In a compiled program a native function of the engine never gets a call, apply, bind or Symbol.hasInstance of its own and keeps its prototype, so hasOwnProperty.call(o, k) is the test in any program, whoever has had the function in hand. Every other name may be added to it, and the functions of the program, bound ones too, stay free.
import { tryToChange, tryToChangePrototype } from "../../fixtures/changes-to-builtins.js";

const closed = ["call", "apply", "bind", Symbol.hasInstance];
const natives = { "Object.prototype.hasOwnProperty": Object.prototype.hasOwnProperty, "Object.prototype.toString": Object.prototype.toString, "Array.prototype.slice": Array.prototype.slice, "Array.prototype.push": Array.prototype.push, "Math.max": Math.max, "String.prototype.trim": String.prototype.trim, "JSON.stringify": JSON.stringify, "parseInt": parseInt };
for (const [name, native] of Object.entries(natives)) {
  tryToChange(name, native, closed);
  tryToChange(name + ", another name", native, ["mine", "toString", "valueOf", "constructor", Symbol("mine"), Symbol.toPrimitive]);
  tryToChangePrototype(name, native);
}

function attempt(run) { try { return String(run()); } catch (error) { return error.name; } }
const mine = () => "mine";
// Through hands that no build can follow.
const hidden = key => globalThis[["Obj", "ect"].join("")].prototype[key];
const poke = (target, key, value) => { target[key] = value; };
console.log("a store nobody can place: " + [attempt(() => poke(hidden("hasOwnProperty"), ["ca", "ll"].join(""), mine)), attempt(() => poke(hidden("toString"), ["app", "ly"].join(""), mine)), attempt(() => Object.assign(hidden("valueOf"), { bind: mine }))].join(" "));
console.log("all at once: " + [attempt(() => Object.defineProperties(Math.min, { call: { value: mine }, other: { value: 1 } })), typeof Math.min.other, attempt(() => Object.assign(Math.min, { first: 1, apply: mine, last: 2 })), Math.min.first, typeof Math.min.last].join(" "));

const has = Object.prototype.hasOwnProperty, tag = Object.prototype.toString, slice = Array.prototype.slice;
function list() { return slice.call(arguments, 1); }
console.log("what they are for: " + [has.call({ a: 1 }, "a"), has.call({ a: 1 }, "b"), has.call([], "length"), has.call("text", 0), tag.call([]), tag.call(null), tag.apply(new Date(0)), list(1, 2, 3), Math.max.apply(null, [1, 5, 3]), Array.prototype.push.apply([], [1, 2]), has.bind({ a: 1 })("a"), Array.prototype.concat.call([1], [2])].join(" "));
console.log("instanceof a native function: " + [attempt(() => ({}) instanceof has), attempt(() => ({}) instanceof Math.max), attempt(() => [] instanceof slice)].join(" "));

function own() { return "called"; }
own.call = mine; own.apply = mine; own.bind = () => mine;
const bound = Math.max.bind(null, 7);
bound.call = mine;
const arrow = () => "called";
Object.setPrototypeOf(arrow, { call: mine });
class Class { static call() { return "static"; } }
console.log("the program's own functions: " + [own.call(), own.apply(), own.bind()(), bound.call(), bound(1), arrow.call(), Class.call()].join(" "));
/* Output:
Object.prototype.hasOwnProperty: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.hasOwnProperty: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.hasOwnProperty, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.hasOwnProperty: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Object.prototype.toString: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.toString: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.toString, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Object.prototype.toString: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Array.prototype.slice: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.slice: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.slice, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.slice: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Array.prototype.push: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.push: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.push, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Array.prototype.push: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
Math.max: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Math.max: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Math.max, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
Math.max: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
String.prototype.trim: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
String.prototype.trim: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
String.prototype.trim, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
String.prototype.trim: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
JSON.stringify: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
JSON.stringify: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
JSON.stringify, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
JSON.stringify: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
parseInt: call apply bind: store TypeError/unchanged, sloppy store TypeError/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
parseInt: Symbol(Symbol.hasInstance): store TypeError/unchanged, sloppy store done/unchanged, Reflect.set false/unchanged, define TypeError/unchanged, Reflect.defineProperty false/unchanged, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
parseInt, another name: mine toString valueOf constructor Symbol(mine) Symbol(Symbol.toPrimitive): store done/changed, sloppy store done/changed, Reflect.set true/changed, define done/changed, Reflect.defineProperty true/changed, delete true/unchanged, sloppy delete true/unchanged, Reflect.deleteProperty true/unchanged
parseInt: its prototype: Object.setPrototypeOf TypeError/unchanged, Reflect.setPrototypeOf false/unchanged, __proto__ TypeError/unchanged, the prototype it has done/unchanged, extensible true
a store nobody can place: TypeError TypeError TypeError
all at once: TypeError undefined TypeError 1 undefined
what they are for: true false true true [object Array] [object Null] [object Date] 2,3 5 2 true 1,2
instanceof a native function: TypeError TypeError TypeError
the program's own functions: mine mine mine mine 7 mine static
*/
