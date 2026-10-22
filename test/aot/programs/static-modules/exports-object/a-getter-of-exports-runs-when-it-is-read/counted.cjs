var inner = require("./inner.cjs");
var reads = 0;
Object.defineProperty(exports, "value", { enumerable: true, get: function () { reads++; return inner.value; } });
exports.reads = function () { return reads; };
