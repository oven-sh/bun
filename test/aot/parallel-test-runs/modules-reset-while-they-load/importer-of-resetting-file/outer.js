import { run as resetterRun } from "./resetter.js";
import { run as lateRun } from "./late.js";
globalThis.runs ??= {}; globalThis.runs.outer = (globalThis.runs.outer ?? 0) + 1;
export const run = globalThis.runs.outer;
export const sees = [resetterRun, lateRun].join();
