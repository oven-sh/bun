// A deferred module imports a name from a CommonJS file. The namespace is read while that file still runs: the file requires an ES module that imports it back, and that load finishes the graph of the reader.
require("./reader.mjs");
console.log("main ends");
