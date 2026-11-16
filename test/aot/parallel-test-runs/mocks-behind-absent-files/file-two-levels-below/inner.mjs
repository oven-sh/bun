export * from "./dep.mjs";
export * from "./other.mjs";
globalThis.runs ??= {}; globalThis.runs.inner = (globalThis.runs.inner ?? 0) + 1;
