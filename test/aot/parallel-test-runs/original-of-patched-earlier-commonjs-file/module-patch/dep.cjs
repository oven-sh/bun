globalThis.count = (globalThis.count ?? 0) + 1;
console.log("SAID body of dep", globalThis.count);
exports.flag = "real" + globalThis.count;
exports.plain = "plain" + globalThis.count;
