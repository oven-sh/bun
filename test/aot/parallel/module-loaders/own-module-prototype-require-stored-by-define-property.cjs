// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
exports.hidden = function () { return "hidden ran"; };
Object.defineProperty(Module.prototype, "require", { value: function (request) { console.log(request, this.exports.hidden()); return { sep: "from the hook" }; }, writable: true, configurable: true, enumerable: true });
console.log(require(process.env.NO_SUCH_VARIABLE ?? "asked").sep);
