process.on("uncaughtException", error => console.log("uncaught", error.message));
setTimeout(() => console.log("later", new (globalThis.retry().Counter)().step(), globalThis.runs));
require("./graph.mjs");
console.log("main");
