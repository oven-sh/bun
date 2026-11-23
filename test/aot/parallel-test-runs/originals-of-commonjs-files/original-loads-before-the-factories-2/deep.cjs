(globalThis.log ??= []).push("deep");
globalThis.deeps = (globalThis.deeps ?? 0) + 1;
exports.deep = globalThis.deeps;
