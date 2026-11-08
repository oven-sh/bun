var held;
function same(x) { return x; }
exports.peek = function () { return typeof held; };
const other = require("./other.cjs");
held = same("stored");
console.log(other.seen, exports.peek());
