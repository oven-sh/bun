// @ts-nocheck
import held = module;
exports.mark = "first";
held.exports = { mark: "second" };
console.log(exports.mark);
