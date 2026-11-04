globalThis.third = (globalThis.third ?? 0) + 1;
exports["run" + globalThis.third] = true;
if (globalThis.third < 3) throw new Error("boom " + globalThis.third);
