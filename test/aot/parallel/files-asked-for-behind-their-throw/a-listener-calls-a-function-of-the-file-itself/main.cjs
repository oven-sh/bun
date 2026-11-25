// a listener for uncaught exceptions calls a function that the file handed out before it threw
process.on("uncaughtException", (error) => {
  console.log("caught:", error.message);
  try { console.log("again:", globalThis.retry().value); } catch (second) { console.log("again threw:", second.message); }
});
require("./flaky.cjs");
console.log("not reached");
