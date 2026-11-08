const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
Module._resolveFilename = function (request, parent) { console.log(request, parent.exports.hidden()); return "node:path"; };
console.log(typeof require(process.env.NO_SUCH_VARIABLE ?? "asked").sep);
