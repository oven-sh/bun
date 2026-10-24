// The entry point replaces `exports` of a child through `module.children`: the holder keeps the first object, the next require() answers the new one.
const a = require("./a.cjs");
module.children[0].exports = { v: 2 };
console.log(a.v, require("./a.cjs").v);
