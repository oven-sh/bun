// A timer reads a constant of a body that threw ahead of it.
process.on("uncaughtException", e => console.log("handler", e.message));
setTimeout(() => { try { console.log(globalThis.peek()); } catch (e) { console.log(e.name); } }, 0);
const a = require("./a.cjs");
