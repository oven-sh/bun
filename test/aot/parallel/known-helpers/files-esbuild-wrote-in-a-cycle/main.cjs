// Two CommonJS files as a bundler writes them that need each other and read each other's names while they run.
var import_a = require("./a.cjs");
var import_b = require("./b.cjs");
console.log("main runs", import_a.early, import_a.late, (0, import_b.seeA)());
