process.on("uncaughtException", error => console.log("uncaught", error.message));
setTimeout(() => {
  console.log("later", globalThis.seen);
  console.log(require("./second.cjs").value);
});
require("./graph.mjs");
console.log("main");
