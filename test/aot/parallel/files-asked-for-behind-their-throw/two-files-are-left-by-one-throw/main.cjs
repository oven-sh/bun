// the throw of the inner file leaves the outer file too: both run again, and the file that had ended does not
globalThis.log = [];
process.on("uncaughtException", (error) => {
  console.log("caught:", error.message);
  try { console.log("again:", globalThis.retry().all); } catch (second) { console.log("again threw:", second.message); }
  console.log(globalThis.log.join(" "));
});
require("./outer.cjs");
console.log("not reached");
