// No cycle in the graph of requires at the top: a third module keeps callbacks, one of them requires m, and m runs the callbacks in the middle of its body. The callback sees m half done, by names and as an object.
require("./registers.cjs");
const m = require("./m.cjs");
console.log(m.seenByNames, m.seenAsAnObject);
const registry = require("./registry.cjs");
console.log(registry.run("names"), registry.run("object"));
