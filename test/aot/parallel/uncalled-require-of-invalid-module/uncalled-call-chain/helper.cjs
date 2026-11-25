function inner() { return require("./bad.ts"); }
function outer() { return inner(); }
exports.other = 1;
