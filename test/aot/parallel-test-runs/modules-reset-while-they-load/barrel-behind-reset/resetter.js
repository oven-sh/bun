import { vi, jest } from "bun:test";
import { run as counterRun } from "./counter.js";
globalThis.runs ??= {}; globalThis.runs.resetter = (globalThis.runs.resetter ?? 0) + 1;
vi.resetModules();
export const run = globalThis.runs.resetter;
export const sees = [counterRun].join();
