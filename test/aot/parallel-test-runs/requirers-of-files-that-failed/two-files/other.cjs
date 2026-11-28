globalThis.otherTries = (globalThis.otherTries ?? 0) + 1;
if (globalThis.otherTries === 1) throw new Error("first");
exports.n = "lib " + globalThis.otherTries;
