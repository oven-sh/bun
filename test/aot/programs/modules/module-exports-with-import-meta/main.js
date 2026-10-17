// A file without `import` or `export` that names `import.meta` is CommonJS by the same signs as any other: `module`, `exports`.
console.log(typeof module, typeof exports, typeof import.meta, this === exports, module.exports === exports);
exports.early = 1;
const assigned = require("./assigned.js");
const named = require("./named.js");
const only = require("./only-import-meta.js");
console.log(JSON.stringify(assigned), JSON.stringify(named), JSON.stringify(only), JSON.stringify(module.exports));
undeclared = 1;
console.log(undeclared, (function () { return this === globalThis; })());
