// What a CommonJS file stores on process is no export of node:process for an importer that names node:process in front of the file, where require() loads the importer.
require("./importer.mjs");
console.log("required");
