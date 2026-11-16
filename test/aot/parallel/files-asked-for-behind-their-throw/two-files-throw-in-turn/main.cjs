// Exit code: 7
process.on("exit", code => {
  console.log("exit", code, globalThis.seen);
  process.exitCode = 7;
});
const graph = require("./graph.mjs");
console.log("main", graph);
