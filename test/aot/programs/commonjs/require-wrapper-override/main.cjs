// `Module.wrapper` holds the text that goes around the source text of a CommonJS module. A compiled module has no source text, so a replaced wrapper is not applied to it: `require` runs the module as it was compiled, where plain Bun runs the added text first.
const Module = require("node:module");
const [start, end] = Module.wrapper;
const seen = () => String(globalThis.wrapped);

console.log("before the replacement:", require("./first.cjs"), seen());

Module.wrapper[0] = start + "globalThis.wrapped = (globalThis.wrapped ?? 0) + 1;";
console.log("first part replaced:", require("./second.cjs"), seen());
console.log("required again:", require("./second.cjs"), require("./first.cjs"), seen());
console.log("required by a compiled module:", require("./requires-third.cjs"), seen());

Module.wrapper = [start + "globalThis.wrapped = 'both parts';", end];
console.log("both parts replaced:", require("./fourth.cjs"), seen());

Module.wrapper = [start, end];
console.log("the default parts again:", require("./fifth.cjs"), seen());
