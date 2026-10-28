// closed-world/inspector-does-nothing in a program that evaluates text where the compiler sees it. The compiler allows for what that text can reach, and a debugger reaches more: inspector.open() still starts none, and startRemoteDebugger of bun:jsc throws.
const inspector = require("node:inspector");
console.log("eval: " + (0, eval)(Buffer.from("1 + 1").toString()));
console.log("inspector.open: " + typeof inspector.open(0));
console.log("inspector.url: " + inspector.url());
console.log("inspector.close: " + inspector.close());
try { console.log("startRemoteDebugger: " + require("bun:jsc").startRemoteDebugger()); } catch (error) { console.log("startRemoteDebugger: " + error.message); }
