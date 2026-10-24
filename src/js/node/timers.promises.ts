// Hardcoded module "node:timers/promises"
// https://github.com/niksy/isomorphic-timers-promises/blob/master/index.js

const { validateBoolean, validateAbortSignal, validateObject, validateNumber } = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");

const setImmediateGlobal = globalThis.setImmediate;
const setTimeoutGlobal = globalThis.setTimeout;
const setIntervalGlobal = globalThis.setInterval;
const clearIntervalGlobal = globalThis.clearInterval;

type TimerOptions = import("node:timers").TimerOptions;

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
  return typeof onCancel !== "undefined"
    ? returnValue.finally(() => signal!.removeEventListener("abort", onCancel))
    : returnValue;
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
  return typeof onCancel !== "undefined"
    ? returnValue.finally(() => signal!.removeEventListener("abort", onCancel))
    : returnValue;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/timers/promises.js#L132-L193
async function* setInterval(after?, value?, options: TimerOptions = {}) {
  if (after !== undefined && typeof after !== "number") {
    validateNumber(after, "delay");
  }
  validateObject(options, "options");
  const { signal, ref: reference = true } = options;
  validateAbortSignal(signal, "options.signal");
  validateBoolean(reference, "options.ref");

  if (signal?.aborted) {
    throw $makeAbortError(undefined, { cause: signal.reason });
  }

  let onCancel;
  let interval;
  try {
    let notYielded = 0;
    // Node's `callback` is the resolve function of a `new Promise()`. This is that promise itself.
    let wake: Promise<unknown> | undefined;
    interval = setIntervalGlobal(() => {
      notYielded++;
      if (wake) {
        const promise = wake;
        wake = undefined;
        $resolvePromise(promise, undefined);
      }
    }, after);
    if (!reference) {
      interval?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearIntervalGlobal(interval);
        if (wake) {
          const promise = wake;
          wake = undefined;
          // Resolved with a rejected promise, as in node: next() then rejects 4 ticks after the abort.
          $resolvePromise(promise, Promise.$reject($makeAbortError(undefined, { cause: signal.reason })));
        }
      };
      signal.addEventListener("abort", onCancel, resistStopPropagation({ __proto__: null, once: true }));
    }

    while (!signal?.aborted) {
      if (notYielded === 0) {
        await (wake = $newPromise());
      }
      for (; notYielded > 0; notYielded--) {
        yield value;
      }
    }
    throw $makeAbortError(undefined, { cause: signal?.reason });
  } finally {
    clearIntervalGlobal(interval);
    signal?.removeEventListener("abort", onCancel);
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
