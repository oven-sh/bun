// Hardcoded module "node:timers"
export const setTimeout = globalThis.setTimeout;
export const clearTimeout = globalThis.clearTimeout;
export const setInterval = globalThis.setInterval;
export const setImmediate = globalThis.setImmediate;
export const clearInterval = globalThis.clearInterval;
export const clearImmediate = globalThis.clearImmediate;
export const _unrefActive = () => {};
export * as promises from "node:timers/promises";
