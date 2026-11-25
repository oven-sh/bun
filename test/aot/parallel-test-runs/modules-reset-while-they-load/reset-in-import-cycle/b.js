import "./a.js";
import { run as counterRun } from "./counter.js";
globalThis.runs ??= {}; globalThis.runs.b = (globalThis.runs.b ?? 0) + 1;
export const run = globalThis.runs.b;
export const sees = [counterRun].join();
