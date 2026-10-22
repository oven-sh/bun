// require() reads `module.exports` at every call, also when the body has ended.
const a = require("./a.cjs");
a.swap();
console.log(a.v, require("./a.cjs").v);
