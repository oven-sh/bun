globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.count = globalThis.runs;
exports.read = () => exports.count;
