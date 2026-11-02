// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
Object.defineProperty(Module, "_resolveFilename", { value: function (request, parent) { console.log(request, parent.exports.hidden()); return "node:path"; }, writable: true, configurable: true, enumerable: true });
console.log(typeof require(process.env.NO_SUCH_VARIABLE ?? "asked").sep);
