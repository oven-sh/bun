// `require("./a.cjs").late` with no variable in between, in the middle of a cycle and behind it, read and called.
require("./a.cjs");
const b = require("./b.cjs");
console.log(b.saw);
console.log(b.now());
