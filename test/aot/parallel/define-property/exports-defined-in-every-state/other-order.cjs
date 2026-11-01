const late = process.argv.length > 100;
if (late) Object.defineProperty(exports, "first", { value: 1, enumerable: true });
Object.defineProperty(exports, "second", { value: 2, enumerable: true });
exports.third = 3;
if (!late) Object.defineProperty(exports, "first", { value: 1, enumerable: true });
Object.defineProperty(exports, "fourth", { get() { return 4; }, enumerable: true });
