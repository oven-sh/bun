globalThis.passedOnLog = [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.passedOnLog.push("a"); return function () {}; } });
exports.z = 1;
