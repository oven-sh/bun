// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
Module._resolveFilename = function (request, parent) { return parent.exports.hidden(); };
console.log(require.resolve("asked"));
