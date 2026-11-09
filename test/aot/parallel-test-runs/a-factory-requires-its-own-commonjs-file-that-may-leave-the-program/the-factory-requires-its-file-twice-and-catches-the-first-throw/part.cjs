globalThis.ran = (globalThis.ran ?? 0) + 1;
if (globalThis.ran === 1) throw new Error("part 1");
exports.x = "real x " + globalThis.ran;
