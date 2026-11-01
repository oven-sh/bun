// What a bundler writes around the exports of a CommonJS file: a name that the exporting file stores again is read anew each time.
var import_lib = require("./lib.cjs");
console.log(import_lib.count, import_lib.label, typeof import_lib.late);
(0, import_lib.inc)();
(0, import_lib.inc)();
console.log(import_lib.count, import_lib.label);
(0, import_lib.fill)();
console.log(typeof import_lib.late, (0, import_lib.late)());
