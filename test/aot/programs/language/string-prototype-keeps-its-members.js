// A compiled program locks the members that String.prototype has at the start: none can be stored, defined or deleted, but for at, the five trim methods and the HTML methods, which packages replace. The object stays extensible for ordinary names and for symbols that the program made, and a string finds what was added. It takes no index-like key, no well-known symbol and no name of Object.prototype, and its prototype stays, so an element past the end of a string is undefined.
import { indexLikeKeys, keysThatOnlyLookNumeric, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

tryToChange("a member", String.prototype, ["charCodeAt", "length", "padEnd", "replace", "split", "toString", "valueOf", "constructor", Symbol.iterator]);
tryToChange("a member that packages replace", String.prototype, ["at", "trim", "trimStart", "trimEnd", "trimLeft", "trimRight", "anchor", "big", "blink", "bold", "fixed", "fontcolor", "fontsize", "italics", "link", "small", "strike", "sub", "sup"]);
tryToChange("an index-like key", String.prototype, indexLikeKeys);
tryToChange("a well-known symbol", String.prototype, wellKnownSymbols.filter(symbol => symbol !== Symbol.iterator));
tryToChange("a name of Object.prototype", String.prototype, ["hasOwnProperty", "isPrototypeOf", "toLocaleString"]);
tryToChange("any other key", String.prototype, ["red", "then", "toJSON", ...keysThatOnlyLookNumeric, Symbol("mine"), Symbol.for("shared")]);
tryToChangePrototype("String.prototype", String.prototype);

const mine = Symbol("mine");
Object.defineProperty(String.prototype, "shout", { get() { return this.toUpperCase() + "!"; }, configurable: true });
String.prototype.twice = function () { return this + this; };
String.prototype[mine] = function () { return this.length; };
function useAdditions(text) { return [text.shout, text.twice(), text[mine]()].join(" "); }
console.log("what the program added: " + ["abc".shout, "abc".twice(), "abc"[mine](), `x${1 + 1}`.shout, useAdditions("de"), new String("f").shout].join(" "));
delete String.prototype.shout;
delete String.prototype.twice;
delete String.prototype[mine];
console.log("and removed: " + [typeof "abc".shout, typeof "abc".twice, typeof "abc"[mine]].join(" "));

function elementOf(text, key) { return text[key]; }
const keys = [0, 2, 3, 5, -1, 1.5, 4294967295, "1", "5", "-1", "1.5", "-0", "NaN"];
console.log("elements of abc: " + keys.map(key => String(elementOf("abc", key))).join(" "));
console.log("by a constant: " + ["abc"[0], "abc"[5], "abc"[-1], "abc"["5"], "abc"["1.5"]].map(String).join(" "));
console.log("has: " + [0 in new String("abc"), 5 in new String("abc"), "5" in new String("abc"), Symbol.replace in new String("abc")].join(" "));

console.log("what looks for a symbol on a string: " + ["a-b".replace("-", "+"), "a-b-c".replaceAll("-", "+"), "a-b".split("-").join("|"), "a-b".search("-"), "a-b".match("-").index, [..."a-b".matchAll("-")].length, Object.prototype.toString.call("x"), [].concat("ab").length, `${"x"}` + "y", [..."ab"].join("|")].join(" "));
