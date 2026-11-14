module.exports = function fails(n) { return "late " + n; };
if (!globalThis.tries) globalThis.tries = 0;
if (++globalThis.tries < 2) throw new Error("try " + globalThis.tries);
