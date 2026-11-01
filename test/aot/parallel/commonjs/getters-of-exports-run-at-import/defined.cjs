Object.defineProperty(exports, "arrow", { enumerable: true, get: () => (console.log("defined: arrow getter runs"), 1) });
Object.defineProperty(exports, "method", { enumerable: true, get() { console.log("defined: method getter runs", this === exports); return 2; } });
Object.defineProperty(exports, "hidden", { enumerable: false, get() { console.log("defined: a getter that is not enumerable runs"); return 3; } });
exports.plain = 4;
console.log("defined ends");
