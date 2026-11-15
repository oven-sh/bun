// A top-level require() of an ES module loads the module's whole graph at once. A CommonJS file that the graph imports is evaluated first, before the loader has any entry for the graph.
// Its require() of a JSON file that the graph also imports returns the value, not the namespace. Every later require() returns the same value, because the first result is cached.
const space = require("./app.mjs");
console.log(typeof space);
require("./later.cjs");
