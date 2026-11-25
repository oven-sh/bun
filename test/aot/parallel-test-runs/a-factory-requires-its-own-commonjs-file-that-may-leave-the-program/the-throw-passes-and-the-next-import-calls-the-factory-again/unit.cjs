globalThis.bodies = (globalThis.bodies ?? 0) + 1;
if (globalThis.bodies === 1) throw new Error("the first run fails");
exports.kept = "real of run " + globalThis.bodies;
