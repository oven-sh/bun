// A require() of an ES module that another require() is still running gets the namespace and lays the mark on it, as it does where an import began the load.
// Todo: "undefined" | "boolean": a wrong answer today: under `bun build --compile --aot` it prints "undefined" for the inner require and behind it, where `bun <file>` prints "boolean"
// In an executable the inner require() of a compiled file gets the empty object that stands in for the file while it loads, so nothing lays the mark before the outer require() ends.
globalThis.again = () => typeof require("./lamp.mjs").__esModule;
const lamp = require("./lamp.mjs");
console.log("behind", typeof lamp.__esModule);
