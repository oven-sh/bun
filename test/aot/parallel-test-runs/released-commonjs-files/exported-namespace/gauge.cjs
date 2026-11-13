globalThis.runs = (globalThis.runs ?? 0) + 1; const own = globalThis.runs;
let count = 0;
exports.word = "run" + own;
exports.bump = () => own + ":" + ++count;
exports.late = undefined;
