globalThis.evaluations = (globalThis.evaluations || 0) + 1;
exports.before = "before " + globalThis.evaluations;
if (globalThis.evaluations < 3) throw new Error("evaluation " + globalThis.evaluations);
exports.after = "after " + globalThis.evaluations;
