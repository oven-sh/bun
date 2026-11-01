const DEBUG = false;
const VERBOSE = DEBUG && true;
function trace(...args) {
  if (!DEBUG) return;
  console.log("[trace]", ...args);
}
trace("never shown");
if (DEBUG) {
  const inspector = require("node:inspector");
  inspector.open();
  debugTools.attach();
}
if (VERBOSE) console.log("verbose");
console.log("done");
