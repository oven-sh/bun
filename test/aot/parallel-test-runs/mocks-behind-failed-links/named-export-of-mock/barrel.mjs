export { a } from "./dep.mjs";
export * from "./other.mjs";
globalThis.runs ??= {}; globalThis.runs.barrel = (globalThis.runs.barrel ?? 0) + 1;
