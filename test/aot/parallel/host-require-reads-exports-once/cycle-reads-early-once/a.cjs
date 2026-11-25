globalThis.leaf = module;
exports.name = "early";
globalThis.again = globalThis.load("./a.cjs");
console.log("SAID inner", JSON.stringify(globalThis.again), globalThis.again === exports);
exports.name = "late";
