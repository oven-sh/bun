// The guard stands in the arm that is not taken: the name holds the function.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = process.argv.length > 99 ? (this && this.__exportStar) : function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
const leaf = { __esModule: true, first: 1, second: 2 };
const top = { __esModule: true, ownOfTop: "top" };
function read(barrel) {
  return barrel.first;
}
try {
  __exportStar(leaf, top);
  console.log("ran");
} catch (error) {
  console.log(error instanceof TypeError, error.message.split(". (In")[0]);
}
console.log(typeof __createBinding, typeof __exportStar, String(read(top)), Object.keys(top).join());
