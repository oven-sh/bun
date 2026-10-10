// Hardcoded module "node:timers"
import * as promises from "node:timers/promises";
export const setTimeout = globalThis.setTimeout;
export const clearTimeout = globalThis.clearTimeout;
export const setInterval = globalThis.setInterval;
export const clearInterval = globalThis.clearInterval;
// Browsers have no setImmediate. Fall back to a zero-delay timeout.
export const setImmediate =
  globalThis.setImmediate ??
  function setImmediate(callback, ...args) {
    return globalThis.setTimeout(callback, 0, ...args);
  };
export const clearImmediate = globalThis.clearImmediate ?? globalThis.clearTimeout;
export const _unrefActive = () => {};
export { promises };
export default {
  promises,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  _unrefActive,
};
