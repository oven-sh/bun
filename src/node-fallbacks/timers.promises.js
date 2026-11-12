// Ported from Node.js v26.3.0 lib/timers/promises.js (MIT License, Copyright Node.js contributors) onto the host's timers.

// Only declarations at the top level: a call, a `new` or a property read there keeps this module in every bundle that has node:timers.
const hostSetTimeout = typeof setTimeout === "function" ? setTimeout : undefined,
  hostClearTimeout = typeof clearTimeout === "function" ? clearTimeout : undefined,
  hostSetInterval = typeof setInterval === "function" ? setInterval : undefined,
  hostClearInterval = typeof clearInterval === "function" ? clearInterval : undefined;

class AbortError extends Error {
  constructor(signal) {
    super("The operation was aborted", { cause: signal?.reason });
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

function nodeTypeError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  Object.defineProperty(error, "toString", {
    value() {
      return `${this.name} [${code}]: ${this.message}`;
    },
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
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const timer = start(() => resolve(value));
  if (!ref) timer?.unref?.();
  if (!signal) return promise;
  const onAbort = () => {
    stop(timer);
    reject(new AbortError(signal));
  };
  signal.addEventListener("abort", onAbort);
  return promise.finally(() => signal.removeEventListener("abort", onAbort));
}

function setTimeoutPromise(after, value, options = {}) {
  return timerPromise(callback => hostSetTimeout(callback, after), hostClearTimeout, after, value, options);
}

function startMessageTask(callback) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    callback();
  };
  port2.postMessage(undefined);
  return port1;
}

function stopMessageTask(port) {
  port.close();
}

function setImmediatePromise(value, options = {}) {
  const { setImmediate: hostSetImmediate, clearImmediate: hostClearImmediate } = globalThis;
  if (hostSetImmediate && hostClearImmediate) {
    return timerPromise(hostSetImmediate, hostClearImmediate, undefined, value, options);
  }
  // Browsers have no setImmediate, and they clamp a nested zero-delay timeout to 4 ms. A message task is not clamped.
  if (typeof MessageChannel === "function") {
    return timerPromise(startMessageTask, stopMessageTask, undefined, value, options);
  }
  return timerPromise(callback => hostSetTimeout(callback, 0), hostClearTimeout, undefined, value, options);
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

// No binding here has the name of a global (browsers have `scheduler`): in a classic script it would replace the page's own.
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
