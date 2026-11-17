globalThis.runs = (globalThis.runs ?? 0) + 1;
const own = globalThis.runs;
exports[["wo", "rd"].join("")] = "leaf " + own;
exports[["s", "ay"].join("")] = () => "leaf " + own;
