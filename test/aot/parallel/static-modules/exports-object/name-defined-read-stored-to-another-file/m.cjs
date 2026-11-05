Object.defineProperty(exports, "x", { value: 1 });
Object.defineProperty(exports, "y", { value: 1, writable: true });
exports.read = () => exports.x + exports.y;
