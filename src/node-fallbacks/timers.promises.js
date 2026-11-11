// Hardcoded module "node:timers/promises"
//
// Ported from Node.js v26.3.0 lib/timers/promises.js, on top of the host's timers.
//
// Copyright Node.js contributors. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

// The bundler drops this module from a bundle that imports `node:timers` and never reads `promises`,
// as long as the top level only declares: no call, no `new`, no property read.
// In a classic script a top-level `var setTimeout` replaces the page's own, so no binding here has a global's name.
const hostSetTimeout = setTimeout,
  hostClearTimeout = clearTimeout,
  hostSetInterval = setInterval,
  hostClearInterval = clearInterval;

class AbortError extends Error {
  constructor(signal) {
    super("The operation was aborted", { cause: signal?.reason });
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

// `String(error)` has the code, as in Node.js.
function nodeTypeError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  Object.defineProperty(error, "toString", {
    value: () => `TypeError [${code}]: ${message}`,
    writable: true,
    configurable: true,
  });
  return error;
}

function invalidArgType(name, expected, value) {
  return nodeTypeError(
    "ERR_INVALID_ARG_TYPE",
    `The "${name}" ${name.includes(".") ? "property" : "argument"} must be ${expected}. Received ${value === null ? "null" : `type ${typeof value}`}`,
  );
}

function validateTimerArguments(after, options) {
  if (after !== undefined && typeof after !== "number") {
    throw invalidArgType("delay", "of type number", after);
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw invalidArgType("options", "of type object", options);
  }
  const { signal, ref } = options;
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw invalidArgType("options.signal", "an instance of AbortSignal", signal);
  }
  if (ref !== undefined && typeof ref !== "boolean") {
    throw invalidArgType("options.ref", "of type boolean", ref);
  }
}

function timerPromise(start, stop, after, value, options) {
  try {
    validateTimerArguments(after, options);
  } catch (error) {
    return Promise.reject(error);
  }
  const { signal, ref = true } = options;
  if (signal?.aborted) {
    return Promise.reject(new AbortError(signal));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      stop(timer);
      reject(new AbortError(signal));
    };
    const timer = start(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    });
    if (!ref) timer?.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function setTimeoutPromise(after, value, options = {}) {
  return timerPromise(callback => hostSetTimeout(callback, after), hostClearTimeout, after, value, options);
}

function setImmediatePromise(value, options = {}) {
  // Browsers have no setImmediate. Fall back to a zero-delay timeout.
  const hostSetImmediate = globalThis.setImmediate;
  return hostSetImmediate
    ? timerPromise(hostSetImmediate, globalThis.clearImmediate, undefined, value, options)
    : timerPromise(callback => hostSetTimeout(callback, 0), hostClearTimeout, undefined, value, options);
}

async function* setIntervalPromise(after, value, options = {}) {
  validateTimerArguments(after, options);
  const { signal, ref = true } = options;
  if (signal?.aborted) {
    throw new AbortError(signal);
  }

  let onAbort, interval;
  try {
    let notYielded = 0;
    let callback;
    interval = hostSetInterval(() => {
      notYielded++;
      if (callback) {
        callback();
        callback = undefined;
      }
    }, after);
    if (!ref) interval?.unref?.();
    if (signal) {
      onAbort = () => {
        hostClearInterval(interval);
        if (callback) {
          callback(Promise.reject(new AbortError(signal)));
          callback = undefined;
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    while (!signal?.aborted) {
      if (notYielded === 0) {
        await new Promise(resolve => (callback = resolve));
      }
      for (; notYielded > 0; notYielded--) {
        yield value;
      }
    }
    throw new AbortError(signal);
  } finally {
    hostClearInterval(interval);
    signal?.removeEventListener("abort", onAbort);
  }
}

function validateScheduler(self) {
  if (self !== timersScheduler) {
    throw nodeTypeError("ERR_INVALID_THIS", 'Value of "this" must be of type Scheduler');
  }
}

// Not `scheduler`: browsers have a global with that name.
const timersScheduler = {
  yield() {
    validateScheduler(this);
    return setImmediatePromise();
  },
  wait(delay, options) {
    validateScheduler(this);
    return setTimeoutPromise(delay, undefined, options);
  },
};

export {
  timersScheduler as scheduler,
  setImmediatePromise as setImmediate,
  setIntervalPromise as setInterval,
  setTimeoutPromise as setTimeout,
};
export default {
  setTimeout: setTimeoutPromise,
  setImmediate: setImmediatePromise,
  setInterval: setIntervalPromise,
  scheduler: timersScheduler,
};
