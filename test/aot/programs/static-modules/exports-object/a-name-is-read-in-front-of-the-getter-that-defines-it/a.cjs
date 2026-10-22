const m = require("./m.cjs");
console.log(exports.x);
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(exports.x);
