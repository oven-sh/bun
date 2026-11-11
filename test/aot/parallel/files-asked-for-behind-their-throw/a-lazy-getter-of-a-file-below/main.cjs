// a lazy getter of a file below asks for the file that is still running, behind its throw
process.on("uncaughtException", (error) => {
  console.log("caught:", error.message);
  try { console.log("again:", globalThis.lazy.index.value); } catch (second) { console.log("again threw:", second.message); }
});
require("./index.cjs");
console.log("not reached");
