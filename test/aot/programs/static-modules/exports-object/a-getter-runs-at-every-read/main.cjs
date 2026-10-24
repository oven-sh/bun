// A getter on `exports` runs at every read through require().
const a = require("./a.cjs");
console.log(a.x, a.x);
