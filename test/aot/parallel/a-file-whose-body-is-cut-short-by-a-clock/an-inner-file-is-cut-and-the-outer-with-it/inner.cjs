globalThis.innerRuns = (globalThis.innerRuns || 0) + 1;
exports.first = 1;
if (globalThis.busy) { globalThis.own = import("./inner.cjs"); globalThis.outer = import("./part.cjs"); for (;;) ; }
exports.last = 2;
