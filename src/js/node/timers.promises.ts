// Hardcoded module "node:timers/promises"
// https://github.com/niksy/isomorphic-timers-promises/blob/master/index.js

const { validateBoolean, validateAbortSignal, validateObject, validateNumber } = require("internal/validators");

const symbolAsyncIterator = Symbol.asyncIterator;

interface TimerOptions {
  ref?: boolean;
  signal?: AbortSignal;
}

interface AsyncIteratorInput {
  next: () => any;
  return?: () => any;
}

interface AsyncIteratorResult {
  next?: () => any;
  return?: () => any;
  [Symbol.asyncIterator]?: () => any;
}

function asyncIterator({ next: nextFunction, return: returnFunction }: AsyncIteratorInput) {
  const result: AsyncIteratorResult = {};
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

function setTimeoutPromise(after: number = 1, value?: any, options: TimerOptions = {}) {
  const arguments_ = [].concat(value ?? []);
  try {
    // If after is a number, but an invalid one (too big, Infinity, NaN), we only want to emit a
    // warning, not throw an error. So we can't call validateNumber as that will throw if the number
    // is outside of a given range.
    if (typeof after != "number") {
      validateNumber(after, "delay");
    }
  } catch (error) {
    return Promise.reject(error);
  }
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.reject(error);
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return Promise.reject(error);
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return Promise.reject(error);
  }
  if (signal?.aborted) {
    return Promise.reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel: (() => void) | undefined;
  const returnValue = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(value), after, ...arguments_);
    if (!reference) {
      timeout?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearTimeout(timeout);
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onCancel);
    }
  });
  return typeof onCancel !== "undefined"
    ? returnValue.finally(() => signal!.removeEventListener("abort", onCancel!))
    : returnValue;
}

function setImmediatePromise(value?: any, options: TimerOptions = {}) {
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.reject(error);
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return Promise.reject(error);
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return Promise.reject(error);
  }
  if (signal?.aborted) {
    return Promise.reject($makeAbortError(undefined, { cause: signal.reason }));
  }
  let onCancel: (() => void) | undefined;
  const returnValue = new Promise((resolve, reject) => {
    const immediate = setImmediate(() => resolve(value));
    if (!reference) {
      immediate?.unref?.();
    }
    if (signal) {
      onCancel = () => {
        clearImmediate(immediate);
        reject($makeAbortError(undefined, { cause: signal.reason }));
      };
      signal.addEventListener("abort", onCancel);
    }
  });
  return typeof onCancel !== "undefined"
    ? returnValue.finally(() => signal!.removeEventListener("abort", onCancel!))
    : returnValue;
}

function setIntervalPromise(after: number = 1, value?: any, options: TimerOptions = {}) {
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
        return Promise.reject(error);
      },
      return: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }
  try {
    validateObject(options, "options");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.reject(error);
      },
      return: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }
  const { signal, ref: reference = true } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.reject(error);
      },
      return: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return asyncIterator({
      next: function () {
        return Promise.reject(error);
      },
      return: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }
  if (signal?.aborted) {
    return asyncIterator({
      next: function () {
        return Promise.reject($makeAbortError(undefined, { cause: signal.reason }));
      },
      return: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }

  let onCancel: (() => void) | undefined;
  let interval: Timer | undefined;

  try {
    let notYielded = 0;
    let callback: (() => void) | undefined;
    interval = setInterval(() => {
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
      signal.addEventListener("abort", onCancel);
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
          return { done: true, value: undefined };
        });
      },
      return: function () {
        clearInterval(interval);
        signal?.removeEventListener("abort", onCancel!);
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  } catch (err) {
    // This catch block seems unlikely to be hit given the setup,
    // but we'll provide a basic cleanup return function.
    return asyncIterator({
      next: function () {
        clearInterval(interval);
        signal?.removeEventListener("abort", onCancel!);
        return Promise.resolve({ done: true, value: undefined });
      },
      return: function () {
        clearInterval(interval);
        signal?.removeEventListener("abort", onCancel!);
        return Promise.resolve({ done: true, value: undefined });
      },
    });
  }
}

export default {
  setTimeout: setTimeoutPromise,
  setImmediate: setImmediatePromise,
  setInterval: setIntervalPromise,
  scheduler: {
    wait: (delay: number, options?: TimerOptions) => setTimeoutPromise(delay, undefined, options),
    yield: (value?: any, options?: TimerOptions) => setImmediatePromise(value, options),
  },
};