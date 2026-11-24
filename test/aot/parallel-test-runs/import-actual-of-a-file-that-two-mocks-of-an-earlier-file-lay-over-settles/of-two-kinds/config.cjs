globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("SAID config runs", globalThis.runs);
exports.mode = "real " + globalThis.runs;
