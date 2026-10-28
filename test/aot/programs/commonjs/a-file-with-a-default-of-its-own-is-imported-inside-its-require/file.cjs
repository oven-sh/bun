Object.defineProperty(exports, "__esModule", { value: true });
console.log("the file begins");
exports.default = { own: true };
exports.early = 1;
require("./module.mjs");
exports.late = 2;
console.log("the file ends");
