// RUN: lower
// OPTIONS: builtin-modules

// Once a second realm exists, whose prototype a string, a number, a boolean or a symbol has hangs on the realm of the code that asks. Names asked of such values by code that does not know what it is handed must still be
// answered rightly, and without asking the run time every time.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const cases = [
  ["string.startsWith", (v) => v.startsWith("a"), "abc"], ["string.indexOf", (v) => v.indexOf("c"), "abc"], ["string.slice", (v) => v.slice(1), "abc"], ["string.nowhere", (v) => v.nowhere, "abc"], ["string.constructor", (v) => v.constructor.name, "abc"],
  ["string.hasOwnProperty", (v) => v.hasOwnProperty("length"), "abc"], ["string.length", (v) => v.length, "abc"], ["number.toString", (v) => v.toString(), 5], ["number.toFixed", (v) => v.toFixed(1), 2.5], ["number.nowhere", (v) => v.nowhere, 7],
  ["boolean.toString", (v) => v.toString(), true], ["boolean.valueOf", (v) => v.valueOf(), false], ["symbol.toString", (v) => v.toString(), Symbol.for("made")], ["symbol.nowhere", (v) => v.nowhere, Symbol.iterator], ["symbol.constructor", (v) => v.constructor.name, Symbol.iterator],
  ["symbol.description", (v) => v.description, Symbol.for("made")],
];
function round(tag, most) {
  for (const [what, f, value] of cases) {
    let last;
    for (let i = 0; i < 50; i++) last = f(value);
    const before = count("operationAOTGetByIdAndCache");
    for (let i = 0; i < 1000; i++) last = f(value);
    const asked = count("operationAOTGetByIdAndCache") - before;
    lines.push(tag + " " + what + ": " + String(last) + (asked <= most(what) ? "" : ": THE RUN TIME WAS ASKED " + asked + " TIMES"));
  }
}
const accessors = new Set(["symbol.description"]);
round("one realm", (what) => (accessors.has(what) ? 1000 : 20));
if (typeof createGlobalObject === "function") lines.push("another realm: " + typeof createGlobalObject());
else lines.push("another realm: " + typeof require("node:vm").createContext({}));
round("two realms", (what) => (accessors.has(what) ? 1000 : 20));
console.log(lines.join("\n"));
