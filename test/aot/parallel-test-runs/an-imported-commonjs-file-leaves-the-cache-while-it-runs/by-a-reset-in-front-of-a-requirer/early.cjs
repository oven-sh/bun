globalThis.early = (globalThis.early ?? 0) + 1;
console.log("early");
exports.v = "early" + globalThis.early;
