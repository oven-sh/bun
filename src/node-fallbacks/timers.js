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

function promiseTimer(start, clear, value, options) {
  return new Promise((resolve, reject) => {
    var id;
    const signal = options?.signal;
    const onAbort = () => {
      clear(id);
      const error = new Error("The operation was aborted", { cause: signal.reason });
      error.name = "AbortError";
      error.code = "ABORT_ERR";
      reject(error);
    };
    if (signal?.aborted) return onAbort();
    id = start(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// `util.promisify(setTimeout)` resolves with `value`, as in node. Without this it would pass the callback last.
const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
setTimeout[promisifyCustom] = (delay, value, options) =>
  promiseTimer(done => setTimeout(done, delay), clearTimeout, value, options);
setImmediate[promisifyCustom] = (value, options) => promiseTimer(setImmediate, clearImmediate, value, options);

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
