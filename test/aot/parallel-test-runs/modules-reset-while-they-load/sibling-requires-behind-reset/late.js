globalThis.runs ??= {}; globalThis.runs.late = (globalThis.runs.late ?? 0) + 1;
const again = require("./counter.js").run;
export const run = globalThis.runs.late;
export const sees = [].join();
export const asked = again;
