globalThis.tries = (globalThis.tries ?? 0) + 1;
exports.n = "early " + globalThis.tries;
require(globalThis.mid);
exports.n = "lib " + globalThis.tries;
