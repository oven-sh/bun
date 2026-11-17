import { run as deepRun } from "./deep.js";
globalThis.runs ??= {}; globalThis.runs.inner = (globalThis.runs.inner ?? 0) + 1;
export const run = globalThis.runs.inner;
export const sees = [deepRun].join();
