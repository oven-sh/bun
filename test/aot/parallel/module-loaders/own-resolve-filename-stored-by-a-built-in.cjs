// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
exports.other = function () { return "other ran"; };
Reflect.set(Module, "_resolveFilename", function (request, parent) { return parent.exports.hidden(); });
console.log(require.resolve("asked"));
Object.assign(Module, { _resolveFilename(request, parent) { return parent.exports.other(); } });
console.log(require.resolve("asked"));
