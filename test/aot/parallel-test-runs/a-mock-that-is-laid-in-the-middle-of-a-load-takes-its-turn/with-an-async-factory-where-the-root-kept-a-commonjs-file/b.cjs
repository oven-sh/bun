globalThis.b = (globalThis.b ?? 0) + 1;
console.log("b");
exports.v = "b" + globalThis.b;
