import "./resetter.js";
import "./b.js";
globalThis.runs ??= {}; globalThis.runs.a = (globalThis.runs.a ?? 0) + 1;
export const run = globalThis.runs.a;
export const sees = [].join();
