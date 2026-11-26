globalThis.d = (globalThis.d ?? 0) + 1;
console.log("dep");
exports.v = "d" + globalThis.d;
