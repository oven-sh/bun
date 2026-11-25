globalThis.runsOfLib = (globalThis.runsOfLib ?? 0) + 1;
console.log("SAID run", globalThis.runsOfLib, "the parent is", module.parent ? String(module.parent.id).replace(/.*[\\/]/, "") : module.parent);
exports.a = "real";
exports.n = globalThis.runsOfLib;
