// node:inspector opens nothing for the compiler, and an executable that admits no code from outside has no debugger: inspector.open() starts none and throws nothing.
const inspector = require("node:inspector");
console.log("inspector.open: " + typeof inspector.open(0));
console.log("inspector.url: " + inspector.url());
console.log("inspector.close: " + inspector.close());
try { console.log("eval: " + new CustomEvent("unknown", { detail: globalThis }).detail[Buffer.from("eval").toString()](Buffer.from("1 + 1").toString())); } catch (error) { console.log("eval: " + error.name); }
