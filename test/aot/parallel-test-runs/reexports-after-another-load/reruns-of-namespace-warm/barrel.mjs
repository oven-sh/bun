export * as space from "./a_test.mjs";
export { bump } from "./a_test.mjs";
globalThis.barrelRuns = (globalThis.barrelRuns ?? 0) + 1;
