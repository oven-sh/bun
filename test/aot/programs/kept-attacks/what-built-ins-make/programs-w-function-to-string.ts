// What built ins make: programs w function to string. It prints what plain Bun prints.
// @ts-nocheck
const other = function other() {};
const key = ["to", "String"].join("");
const object = globalThis[["Fun", "ction"].join("")].prototype;
try { object[key] = other; console.log(object.toString === other ? "REPLACED" : "ignored"); } catch (e) { console.log("refused", e.message); }
