// Hardcoded module "node:timers"
import * as promises from "node:timers/promises";

// Read once, so that a page which replaces a timer global later does not change this module.
const {
  setTimeout: timersHostSetTimeout,
  clearTimeout: timersHostClearTimeout,
  setInterval: timersHostSetInterval,
  clearInterval: timersHostClearInterval,
  setImmediate: timersHostSetImmediate,
  clearImmediate: timersHostClearImmediate,
} = globalThis;

// A browser throws "Illegal invocation" when a timer function is called as a method, so none of these pass `this`.
const timersSetTimeout = (...args) => timersHostSetTimeout(...args);
const timersClearTimeout = id => timersHostClearTimeout(id);
const timersSetInterval = (...args) => timersHostSetInterval(...args);
const timersClearInterval = id => timersHostClearInterval(id);
// Browsers have no setImmediate. Fall back to a zero-delay timeout.
const timersSetImmediate = timersHostSetImmediate
  ? (...args) => timersHostSetImmediate(...args)
  : (callback, ...args) => timersHostSetTimeout(callback, 0, ...args);
const timersClearImmediate = timersHostSetImmediate ? id => timersHostClearImmediate(id) : timersClearTimeout;

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

// `util.promisify(timers.setTimeout)` resolves with `value`, as in node. Without this it would pass the callback last.
const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
timersSetTimeout[promisifyCustom] = (delay, value, options) =>
  promiseTimer(done => timersSetTimeout(done, delay), timersClearTimeout, value, options);
timersSetImmediate[promisifyCustom] = (value, options) =>
  promiseTimer(timersSetImmediate, timersClearImmediate, value, options);

export const _unrefActive = () => {};
// In a classic script a top-level `var setTimeout` replaces the page's own, so no binding here has a global's name.
export {
  timersClearImmediate as clearImmediate,
  timersClearInterval as clearInterval,
  timersClearTimeout as clearTimeout,
  promises,
  timersSetImmediate as setImmediate,
  timersSetInterval as setInterval,
  timersSetTimeout as setTimeout,
};
export default {
  promises,
  setTimeout: timersSetTimeout,
  clearTimeout: timersClearTimeout,
  setInterval: timersSetInterval,
  clearInterval: timersClearInterval,
  setImmediate: timersSetImmediate,
  clearImmediate: timersClearImmediate,
  _unrefActive,
};
