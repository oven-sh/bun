// CommonJS cycles and exports replaced late: a requirer sees the partial object, later readers the final one.
const a = require("./a.cjs");
console.log(typeof a, a.name, a.fromB, a.late);
const b = require("./b.cjs"); console.log(b.sawType, b.sawKeys, b.readLater(), b.held === a);
