// What a bundler writes around the exports of a CommonJS file: names that stand for names of another file.
var import_lib = require("./lib.cjs");
console.log(import_lib.one, (0, import_lib.deux)(), import_lib.innerDefault, import_lib.three);
