import { run as counterRun } from "./counter.js";
globalThis.runs ??= {}; globalThis.runs.late = (globalThis.runs.late ?? 0) + 1;
export const run = globalThis.runs.late;
export const sees = [counterRun].join();
