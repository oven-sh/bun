// `Module.wrap` returns source text with the wrapper around it, and no loader calls it. A program can put a function of its own in its place, and `require` of a compiled file loads the file as before. `Module.wrap` and `Module.wrapper` answer as in plain Bun.
const Module = require("node:module");
console.log("before the replacement:", require("./before.js").value);
console.log("Module.wrap gives:", typeof Module.wrap("1"));
console.log("Module.wrapper has parts:", Module.wrapper.length);
const original = Module.wrap;
let calls = 0;
let said = "stored";
try { Module.wrap = function (text) { calls++; return original(text); }; } catch (error) { said = error.constructor.name; }
console.log("the replacement:", said);
let loaded;
try { loaded = require("./after.js").value; } catch { loaded = "require throws"; }
console.log("after the replacement:", loaded);
console.log("the replacement ran:", calls);
