const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
Module.prototype.require = function (request) { return request + ": " + this.exports.hidden(); };
console.log(require(process.env.NO_SUCH_VARIABLE ?? "asked"));
