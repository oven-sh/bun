globalThis.mods ??= [];
globalThis.mods.push(module);
require(globalThis.mods.length === 1 ? "./kept.cjs" : "./other.cjs");
if (globalThis.mods.length < 3) throw new Error("again");
exports.four = 4;
