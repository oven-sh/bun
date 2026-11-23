// `module.children` before and behind the first call of a function that requires.
// STATISTIC: RequiresRecorded >= 1
const lazy = () => require("./b.cjs");
require("./a.cjs");
const before = module.children.length;
lazy();
lazy();
console.log(before, module.children.length, module.children[1].exports.y);
