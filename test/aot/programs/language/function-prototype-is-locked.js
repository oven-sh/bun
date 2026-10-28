// In a compiled program every string key and every well-known symbol of Function.prototype is fixed, whether it is there or not, and its prototype stays. Open are toString, which core-js replaces when it loads (String(f) sees the new one), two names that core-js adds, and symbols that the program made. A function, a class and a function with another prototype can still have a call, apply or Symbol.hasInstance of their own.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

tryToChange("a member", Function.prototype, ["call", "apply", "bind", "constructor", "caller", "arguments", "length", "name", Symbol.hasInstance]);
tryToChange("a new key", Function.prototype, ["addedByTheProgram", "prototype", "then", "toJSON", "valueOf", ...indexLikeKeys, ...wellKnownSymbols.filter(symbol => symbol !== Symbol.hasInstance)]);
tryToChange("a key that stays open", Function.prototype, ["demethodize", "unThis", Symbol("mine"), Symbol.for("shared")]);
tryToChange("the member that stays open", Function.prototype, ["toString"]);
tryToChangePrototype("Function.prototype", Function.prototype);

function named() {}
const original = Function.prototype.toString;
Function.prototype.toString = function () { return "<" + this.name + ">"; };
console.log("toString after an assignment: " + [String(named), `${named}`, named + "", named.toString(), String(class Point {}), String(Math.max)].join(" "));
Function.prototype.toString = original;
console.log("and with the original again: " + [Function.prototype.toString === original, typeof String(named), String(named) === "<named>"].join(" "));

function add(a, b) { return this.base + a + b; }
const ten = { base: 10 };
console.log("the members: " + [add.call(ten, 1, 2), add.apply(ten, [1, 2]), add.bind(ten, 1)(2), Reflect.apply(add, ten, [1, 2]), add instanceof Function, ten instanceof Function].join(" "));

function own() { return "called"; }
own.call = function () { return "its-own-call"; };
own.bind = function () { return () => "its-own-bind"; };
console.log("a function with its own call and bind: " + [own.call(), own.bind()(), own(), Function.prototype.call.call(own)].join(" "));

class Shadowing {
  static call() { return "static-call"; }
  static apply = "static-apply";
  static [Symbol.hasInstance](value) { return value === 1; }
}
console.log("a class with static members of the same names: " + [Shadowing.call(), Shadowing.apply, 1 instanceof Shadowing, 2 instanceof Shadowing].join(" "));

class Plain {}
class Derived extends Plain { static inherited = "no"; }
Plain.inherited = "yes";
console.log("what a class does not have: " + [typeof Plain.prototype, String(Plain.missing), Plain.name, Plain.length, new Plain() instanceof Plain, Derived.inherited, String(Derived.missing), "prototype" in (() => 1), String((() => 1).prototype)].join(" "));

function moved() { return "called"; }
Object.setPrototypeOf(moved, { call() { return "another-call"; } });
console.log("a function with another prototype: " + [moved.call(), moved(), typeof moved.apply, moved instanceof Function].join(" "));
