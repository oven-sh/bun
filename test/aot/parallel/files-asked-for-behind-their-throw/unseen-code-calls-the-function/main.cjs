// the listener is made by code that the build has not seen, and finds the function on the global object
process.on("uncaughtException", (0, eval)("(error) => { console.log('caught:', error.message); try { console.log('again:', globalThis.retry().value); } catch (second) { console.log('again threw:', second.message); } }"));
require("./flaky.cjs");
console.log("not reached");
