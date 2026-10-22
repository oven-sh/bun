// A CommonJS file is required, one of its names is stored again, and only then an ES module imports the name: the copy is taken when the file is first linked into a graph of ES modules, not when its body ends.
const k = require("./k.cjs");
k.set();
require("./e.mjs");
