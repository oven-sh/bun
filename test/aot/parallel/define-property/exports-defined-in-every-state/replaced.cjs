Object.defineProperty(exports, "old", { value: 1, enumerable: true });
module.exports = { fresh: 1 };
Object.defineProperty(module.exports, "late", { value: 2 });
Object.defineProperty(exports, "older", { value: 3, enumerable: true });
module.exports.old = Object.keys(exports).join();
