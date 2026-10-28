// A member of a built in module is replaced and put back.
const fs = require("fs");
const path = require("node:path");
const original = path.basename;
path.basename = () => "replaced";
console.log(path.basename("/a/b"), require("path").basename("/a/b"), require("./a.cjs").viaImport());
path.basename = original;
console.log(path.basename("/a/b"), require("./a.cjs").viaImport());
fs.existsSync = () => "patched";
console.log(fs.existsSync("/"), require("node:fs").existsSync("/"), require("./a.cjs").exists());
