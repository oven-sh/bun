globalThis.tries = (globalThis.tries ?? 0) + 1;
if (globalThis.tries === 1) throw new Error("first");
exports.n = "lib " + globalThis.tries;
