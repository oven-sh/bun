globalThis.log.push("inner");
if (globalThis.log.length < 4) throw new Error("first run");
exports.name = "inner";
