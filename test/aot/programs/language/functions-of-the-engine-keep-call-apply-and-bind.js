// In a compiled program a native function of the engine never gets a call, apply, bind or Symbol.hasInstance of its own and keeps its prototype, so hasOwnProperty.call(o, k) is the test in any program, whoever has had the function in hand. Every other name may be added to it, and the functions of the program, bound ones too, stay free.
import { tryToChange, tryToChangePrototype } from "../changes-to-builtins.js";

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
