globalThis.runs ??= {}; globalThis.runs.barrel = (globalThis.runs.barrel ?? 0) + 1;
export * from "./dep.mjs";
export * from "./other.mjs";
export const own = "own";
