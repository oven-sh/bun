globalThis.runs = (globalThis.runs || 0) + 1;
exports.early = 1;
if (globalThis.busy) for (;;) ;
exports.late = 2;
