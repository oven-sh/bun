// Closures of a file that threw half way run later.
process.on("uncaughtException", e => console.log("handler", e.name));
globalThis.later = [];
setTimeout(() => { for (const f of globalThis.later) { try { console.log(f()); } catch (e) { console.log(e.name); } } }, 0);
require("./t.cjs");
