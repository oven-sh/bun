// A timer reads the exports of a body that threw half way.
process.on("uncaughtException", e => console.log("handler", e.message));
const a = require("./a.cjs");
console.log("not reached", a.early);
