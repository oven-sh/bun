// A timer reads what a require that threw should have filled.
process.on("uncaughtException", e => console.log("handler", e.message));
require("./m.cjs");
