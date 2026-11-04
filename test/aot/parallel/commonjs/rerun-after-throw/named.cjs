globalThis.named = (globalThis.named ?? 0) + 1;
exports.half = true;
throw new Error("boom " + globalThis.named);
