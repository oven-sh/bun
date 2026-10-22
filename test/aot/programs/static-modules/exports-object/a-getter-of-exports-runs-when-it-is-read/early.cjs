function said(f) { try { return String(f()); } catch (error) { return error.constructor.name; } }
Object.defineProperty(exports, "value", { enumerable: true, get: function () { return inner.value; } });
exports.log = said(() => exports.value);
var inner = require("./inner.cjs");
exports.log += "," + said(() => exports.value);
