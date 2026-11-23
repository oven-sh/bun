import { a } from "./dep.mjs";
export * from "./other.mjs";
export const copy = a;
export { a };
globalThis.runs ??= {}; globalThis.runs.barrel = (globalThis.runs.barrel ?? 0) + 1;
