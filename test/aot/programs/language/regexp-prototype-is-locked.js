// A compiled program locks RegExp.prototype entirely: no member can be stored, defined or deleted, no key can be added, and its prototype stays. A RegExp object is not locked: a subclass with its own exec, an object with its own exec and an object with another prototype run their own code.
import { indexLikeKeys, tryToChange, tryToChangePrototype, wellKnownSymbols } from "../changes-to-builtins.js";

const members = ["exec", "test", "toString", "compile", "constructor", "flags", "global", "source", "sticky", Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split];
tryToChange("a member", RegExp.prototype, members);
tryToChange("a new key", RegExp.prototype, ["addedByTheProgram", "lastIndex", "then", Symbol("mine"), Symbol.for("shared"), ...indexLikeKeys, ...wellKnownSymbols.filter(symbol => !members.includes(symbol))]);
tryToChangePrototype("RegExp.prototype", RegExp.prototype);

class Shouting extends RegExp {
  exec(text) {
    const match = super.exec(text);
    if (match) match[0] = match[0].toUpperCase();
    return match;
  }
}
const shouting = new Shouting("b+");
console.log("a subclass with its own exec: " + [shouting.test("abbc"), shouting.test("xyz"), "abbc".replace(shouting, found => "[" + found + "]"), "abbc".match(shouting)[0], "abbc".search(shouting), "abbc".split(shouting).join("|")].join(" "));

const findsZ = /b+/;
findsZ.exec = function (text) {
  const index = text.indexOf("z");
  return index < 0 ? null : Object.assign(["z"], { index, input: text });
};
console.log("an object with its own exec: " + [findsZ.test("abbc"), findsZ.test("xz"), "abbc".replace(findsZ, "!"), "xzy".replace(findsZ, "!"), "xzy".search(findsZ), String("abbc".match(findsZ))].join(" "));
delete findsZ.exec;
console.log("the same object without it: " + [findsZ.test("abbc"), findsZ.test("xz"), "abbc".replace(findsZ, "!")].join(" "));

const moved = /b+/;
Object.setPrototypeOf(moved, { test() { return "another test"; }, __proto__: RegExp.prototype });
console.log("an object with another prototype: " + [moved.test("abbc"), moved.exec("abbc")[0], moved instanceof RegExp].join(" "));

const repeated = /a/g;
repeated.lastIndex = 1;
console.log("lastIndex belongs to the object: " + [repeated.test("aa"), repeated.lastIndex, repeated.test("aa"), repeated.lastIndex, Object.hasOwn(RegExp.prototype, "lastIndex")].join(" "));

function countMatches(pattern, texts) {
  let count = 0;
  for (const text of texts) if (pattern.test(text)) count++;
  return count;
}
console.log("literals: " + [countMatches(/^a+$/, ["a", "aa", "b", ""]), /(\d+)-(\d+)/.exec("10-20").slice(1).join(), "a1b22".replace(/\d+/g, digits => "<" + digits + ">"), "a,b;c".split(/[,;]/).length].join(" "));
