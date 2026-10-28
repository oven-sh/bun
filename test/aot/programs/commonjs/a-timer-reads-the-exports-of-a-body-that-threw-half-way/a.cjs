setTimeout(() => console.log(typeof exports.late, exports.early, typeof late2, Object.keys(exports).join()), 0);
exports.early = 1;
boom();
exports.late = function () {};
function boom() { throw new Error("boom"); }
var late2 = function () {};
