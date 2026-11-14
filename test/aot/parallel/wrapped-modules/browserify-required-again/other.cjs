globalThis.others = (globalThis.others || 0) + 1;
if (globalThis.others === 1) throw new Error("other " + globalThis.others);
exports.name = "other"; exports.times = 0;
