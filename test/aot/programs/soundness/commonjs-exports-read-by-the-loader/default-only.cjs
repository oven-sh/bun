globalThis.defaultOnlyLog = [];
exports.used = function () { return "used"; };
Object.defineProperty(exports, "unused", { enumerable: true, get() { globalThis.defaultOnlyLog.push("unused getter ran"); return 1; } });
