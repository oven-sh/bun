globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.x = "real " + globalThis.runs;
