// The require that closes the cycle stands under a `try`.
require("./a.cjs");
const b = require("./b.cjs");
console.log(b.saw, b.now());
