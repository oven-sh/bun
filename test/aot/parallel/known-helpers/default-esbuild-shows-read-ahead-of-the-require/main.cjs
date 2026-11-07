// Two CommonJS files as a bundler writes them that need each other: a default that is read before its require has run.
var import_a = require("./a.cjs");
console.log("main", (0, import_a.early)());
