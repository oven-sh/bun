globalThis.c = (globalThis.c ?? 0) + 1;
console.log("c");
exports.v = "c" + globalThis.c;
