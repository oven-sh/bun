globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs < 2) throw new Error("part fails");
exports.x = "real";
