// Hardcoded module "node:timers/promises"
// https://github.com/niksy/isomorphic-timers-promises/blob/master/index.js

const { validateBoolean, validateAbortSignal, validateObject, validateNumber } = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");

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

// As SafePromisePrototypeFinally() in Node's lib/timers/promises.js: an abort rejects the caller 6 ticks later.
function removeAbortListenerWhenSettled(promise: Promise<unknown>, signal: AbortSignal, onCancel: () => void) {
  return promise.$then(
    value => {
      signal.removeEventListener("abort", onCancel);
      return value;
    },
    error => {
      signal.removeEventListener("abort", onCancel);
      // The 4 ticks that finally() and then() take in Node's wrapper. JSC's finally() takes fewer.
      return Promise.$resolve().$then(() => Promise.$reject(error));
    },
  );
}

function setTimeout(after = 1, value?, options: TimerOptions = {}) {
  const arguments_ = [].concat(value ?? []);
  try {
    // If after is a number, but an invalid one (too big, Infinity, NaN), we only want to emit a
    // warning, not throw an error. So we can't call validateNumber as that will throw if the number
    // is outside of a given range.
    if (typeof after != "number") {
      validateNumber(after, "delay");
    }
  } catch (error) {
    return Promise.$reject(error);
  }
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.$reject(error);
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return Promise.$reject(error);
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return Promise.$reject(error);
  }
  if (signal?.aborted) {
    return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const timeout = setTimeoutGlobal(() => resolve(value), after, ...arguments_);
    if (!reference) {
      timeout?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearTimeout(timeout);
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null }));
    }
  });
  return typeof onCancel !== "undefined" ? removeAbortListenerWhenSettled(returnValue, signal!, onCancel) : returnValue;
}

function setImmediate(value?, options: TimerOptions = {}) {
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.$reject(error);
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return Promise.$reject(error);
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return Promise.$reject(error);
  }
  if (signal?.aborted) {
    return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const immediate = setImmediateGlobal(() => resolve(value));
    if (!reference) {
      immediate?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearImmediate(immediate);
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null }));
    }
  });
  return typeof onCancel !== "undefined" ? removeAbortListenerWhenSettled(returnValue, signal!, onCancel) : returnValue;
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
        if (notYielded === 0 && signal?.aborted) {
          // The signal aborted while no next() waited: tick 1, as in Node.
          return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
        }
        return new Promise<void>(resolve => {
          if (notYielded === 0) {
            callback = resolve;
          } else {
            resolve();
          }
        }).$then(() => {
          if (notYielded > 0) {
            notYielded = notYielded - 1;
            return { done: false, value: value };
          } else if (signal?.aborted) {
            // The abort woke this next(). A rejected promise, not a throw: 4 ticks after the abort, as in Node.
            return Promise.$reject($makeAbortError(undefined, { cause: signal.reason }));
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
