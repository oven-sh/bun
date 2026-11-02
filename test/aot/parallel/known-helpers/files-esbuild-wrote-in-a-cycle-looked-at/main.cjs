// Two CommonJS files as a bundler writes them that need each other, one of which lists the names of the other while it runs.
var import_a = require("./a.cjs");
var import_b = require("./b.cjs");
console.log("main runs", import_a.early, import_a.late, (0, import_b.seeA)());
