process.on("uncaughtException", error => console.log("uncaught", error.message));
setTimeout(() => console.log("later", globalThis.seen));
const { value } = require("./graph.mjs");
console.log("main", value);
