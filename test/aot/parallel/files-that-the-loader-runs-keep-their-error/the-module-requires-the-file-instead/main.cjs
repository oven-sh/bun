// the ES module asks by require(): the file leaves the cache with its throw and runs again
process.on("uncaughtException", (error) => {
  console.log("caught:", error.message);
  try { console.log("again:", globalThis.retry().value, globalThis.runs); } catch (second) { console.log("again threw:", second.message, second === error, globalThis.runs); }
});
require("./middle.mjs");
console.log("not reached");
