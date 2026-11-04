globalThis.always = (globalThis.always ?? 0) + 1;
exports.half = true;
throw new Error("boom " + globalThis.always);
