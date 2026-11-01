// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
exports.first = function () { return "first ran"; };
exports.second = function () { return "second ran"; };
exports.third = function () { return "third ran"; };
exports.fourth = function () { return "fourth ran"; };
let which = "first";
Module._resolveFilename = function (request, parent) { return parent.exports[which](); };
console.log(require.resolve("asked"));
which = "second";
const box = { resolve: require.resolve };
console.log(box.resolve("asked"));
which = "third";
console.log(require.resolve.call(null, "asked"));
which = "fourth";
console.log(Reflect.apply(require.resolve, undefined, ["asked"]));
