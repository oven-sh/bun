// Hardcoded module "node:timers/promises"
// https://github.com/niksy/isomorphic-timers-promises/blob/master/index.js

const { validateBoolean, validateAbortSignal, validateObject, validateNumber } = require("internal/validators");
const { kEmptyObject, resistStopPropagation } = require("internal/shared");

const symbolAsyncIterator = Symbol.asyncIterator;
const setImmediateGlobal = globalThis.setImmediate;
const setTimeoutGlobal = globalThis.setTimeout;
const setIntervalGlobal = globalThis.setInterval;

type TimerOptions = import("node:timers").TimerOptions;

interface TimerAsyncIteratorMethods {
  next?: () => unknown;
  return?: () => unknown;
}

interface TimerAsyncIterator extends TimerAsyncIteratorMethods {
  [Symbol.asyncIterator]?(): this;
}

function asyncIterator({ next: nextFunction, return: returnFunction }: TimerAsyncIteratorMethods) {
  const result: TimerAsyncIterator = {};
  if (typeof nextFunction === "function") {
    result.next = nextFunction;
  }
  if (typeof returnFunction === "function") {
    result.return = returnFunction;
  }
  result[symbolAsyncIterator] = function () {
    return this;
  };

  return result;
}

function resolveTimer(promise: Promise<unknown>, value: unknown) {
  $resolvePromiseWithFirstResolvingFunctionCallCheck(promise, value);
}

function setTimeout(after = 1, value?, options: TimerOptions = kEmptyObject) {
  let reference = true;
  if (options !== kEmptyObject || typeof after != "number") {
    try {
      // If after is a number, but an invalid one (too big, Infinity, NaN), we only want to emit a
      // warning, not throw an error. So we can't call validateNumber as that will throw if the number
      // is outside of a given range.
      if (typeof after != "number") {
        validateNumber(after, "delay");
      }
      validateObject(options, "options");
    } catch (error) {
      return Promise.$reject(error);
    }
    const { signal, ref = true } = options;
    try {
      validateAbortSignal(signal, "options.signal");
      validateBoolean(ref, "options.ref");
    } catch (error) {
      return Promise.$reject(error);
    }
    if (signal) return setTimeoutWithSignal(after, value, signal, ref);
    reference = ref;
  }
  const promise = $newPromise();
  const timeout = setTimeoutGlobal(resolveTimer, after, promise, value);
  if (!reference) {
    timeout?.unref?.();
  }
  return promise;
}

function setTimeoutWithSignal(after: number, value: unknown, signal: AbortSignal, reference: boolean) {
  if (signal.aborted) {
    return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const timeout = setTimeoutGlobal(() => resolve(value), after);
    if (!reference) {
      timeout?.unref?.();
    }
    onCancel = () => {
      clearTimeout(timeout);
      reject($makeAbortError(undefined, { cause: signal.reason }));
    };
    signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null }));
  });
  return returnValue.finally(() => signal.removeEventListener("abort", onCancel));
}

function setImmediate(value?, options: TimerOptions = kEmptyObject) {
  let reference = true;
  if (options !== kEmptyObject) {
    try {
      validateObject(options, "options");
    } catch (error) {
      return Promise.$reject(error);
    }
    const { signal, ref = true } = options;
    try {
      validateAbortSignal(signal, "options.signal");
      validateBoolean(ref, "options.ref");
    } catch (error) {
      return Promise.$reject(error);
    }
    if (signal) return setImmediateWithSignal(value, signal, ref);
    reference = ref;
  }
  const promise = $newPromise();
  const immediate = setImmediateGlobal(resolveTimer, promise, value);
  if (!reference) {
    immediate?.unref?.();
  }
  return promise;
}

function setImmediateWithSignal(value: unknown, signal: AbortSignal, reference: boolean) {
  if (signal.aborted) {
    return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const immediate = setImmediateGlobal(() => resolve(value));
    if (!reference) {
      immediate?.unref?.();
    }
    onCancel = () => {
      clearImmediate(immediate);
      reject($makeAbortError(undefined, { cause: signal.reason }));
    };
    signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null }));
  });
  return returnValue.finally(() => signal.removeEventListener("abort", onCancel));
}

function setInterval(after = 1, value?, options: TimerOptions = {}) {
  /* eslint-disable no-undefined, no-unreachable-loop, no-loop-func */
  try {
    // If after is a number, but an invalid one (too big, Infinity, NaN), we only want to emit a
    // warning, not throw an error. So we can't call validateNumber as that will throw if the number
    // is outside of a given range.
    if (typeof after != "number") {
      validateNumber(after, "delay");
    }
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.$reject(error);
      },
    });
  }
  try {
    validateObject(options, "options");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.$reject(error);
      },
    });
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.$reject(error);
      },
    });
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.$reject(error);
      },
    });
  }
  if (signal?.aborted) {
    return asyncIterator({
      next: function () {
        return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
      },
    });
  }

  let onCancel, interval;

  try {
    let notYielded = 0;
    let callback;
    interval = setIntervalGlobal(() => {
      notYielded++;
      if (callback) {
        callback();
        callback = undefined;
      }
    }, after);
    if (!reference) {
      interval?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearInterval(interval);
        if (callback) {
          callback();
          callback = undefined;
        }
      };
      signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null, once: true }));
    }

    return asyncIterator({
      next: function () {
        return new Promise<void>((resolve, reject) => {
          if (!signal?.aborted) {
            if (notYielded === 0) {
              callback = resolve;
            } else {
              resolve();
            }
          } else if (notYielded === 0) {
            reject($makeAbortError(undefined, { cause: signal.reason }));
          } else {
            resolve();
          }
        }).then(() => {
          if (notYielded > 0) {
            notYielded = notYielded - 1;
            return { done: false, value: value };
          } else if (signal?.aborted) {
            throw $makeAbortError(undefined, { cause: signal.reason });
          }
          return { done: true };
        });
      },
      return: function () {
        clearInterval(interval);
        signal?.removeEventListener("abort", onCancel);
        return Promise.$resolve({});
      },
    });
  } catch {
    return asyncIterator({
      next: function () {
        clearInterval(interval);
        signal?.removeEventListener("abort", onCancel);
      },
    });
  }
}

export default {
  setTimeout,
  setImmediate,
  setInterval,
  scheduler: {
    wait: (delay, options) => setTimeout(delay, undefined, options),
    yield: setImmediate,
  },
};
