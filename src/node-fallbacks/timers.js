// Hardcoded module "node:timers"
import * as promises from "node:timers/promises";

// A browser throws "Illegal invocation" when a timer function is called as a method, so none of these use `this`.
export const setTimeout = (...args) => globalThis.setTimeout(...args);
export const clearTimeout = id => globalThis.clearTimeout(id);
export const setInterval = (...args) => globalThis.setInterval(...args);
export const clearInterval = id => globalThis.clearInterval(id);
// Browsers have no setImmediate. Fall back to a zero-delay timeout.
const hasSetImmediate = typeof globalThis.setImmediate === "function";
export const setImmediate = hasSetImmediate
  ? (...args) => globalThis.setImmediate(...args)
  : (callback, ...args) => globalThis.setTimeout(callback, 0, ...args);
export const clearImmediate = hasSetImmediate ? id => globalThis.clearImmediate(id) : id => globalThis.clearTimeout(id);
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
