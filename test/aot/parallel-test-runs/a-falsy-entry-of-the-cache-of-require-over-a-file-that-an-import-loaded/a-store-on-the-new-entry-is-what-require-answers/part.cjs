globalThis.runs = (globalThis.runs ?? 0) + 1;
globalThis.own = module;
exports.x = "real " + globalThis.runs;
