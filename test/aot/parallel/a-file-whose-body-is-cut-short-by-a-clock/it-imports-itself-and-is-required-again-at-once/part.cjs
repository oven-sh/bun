globalThis.runs = (globalThis.runs || 0) + 1;
exports.early = 1;
if (globalThis.busy) { globalThis.own = import("./part.cjs"); for (;;) ; }
exports.late = 2;
