// The first import() of node:path takes the snapshot: a file that is linked behind a later store gets the values of that import().
const path = require("node:path");
path.sep = "first";
const names = await import("node:path");
path.sep = "second";
await import("./late.mjs");
console.log(names.sep, path.sep, names.default === path);
