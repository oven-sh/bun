var validateObject = function(object, name) {
  if (object === null || typeof object !== "object")
    throw new ERR_INVALID_ARG_TYPE(name, "Object", object);
}, validateBoolean = function(value, name) {
  if (typeof value !== "boolean")
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
}, validateAbortSignal = function(signal, name) {
  if (typeof signal !== "undefined" && (signal === null || typeof signal !== "object" || !("aborted" in signal)))
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
}, asyncIterator = function({ next: nextFunction, return: returnFunction }) {
  const result = {};
  if (typeof nextFunction === "function")
    result.next = nextFunction;
  if (typeof returnFunction === "function")
    result.return = returnFunction;
  return result[symbolAsyncIterator] = function() {
    return this;
  }, result;
}, setTimeoutPromise = function(after = 1, value, options = {}) {
  const arguments_ = [].concat(value ?? []);
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.reject(error);
  }
  const { signal, ref: reference = !0 } = options;
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
  if (signal?.aborted)
    return Promise.reject(new AbortError);
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(value), after, ...arguments_);
    if (!reference)
      timeout?.unref?.();
    if (signal)
      onCancel = () => {
        clearTimeout(timeout), reject(new AbortError);
      }, signal.addEventListener("abort", onCancel);
  });
  if (typeof onCancel !== "undefined")
    returnValue.finally(() => signal.removeEventListener("abort", onCancel));
  return returnValue;
}, setImmediatePromise = function(value, options = {}) {
  try {
    validateObject(options, "options");
  } catch (error) {
    return Promise.reject(error);
  }
  const { signal, ref: reference = !0 } = options;
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
  if (signal?.aborted)
    return Promise.reject(new AbortError);
  let onCancel;
  const returnValue = new Promise((resolve, reject) => {
    const immediate = setImmediate(() => resolve(value));
    if (!reference)
      immediate?.unref?.();
    if (signal)
      onCancel = () => {
        clearImmediate(immediate), reject(new AbortError);
      }, signal.addEventListener("abort", onCancel);
  });
  if (typeof onCancel !== "undefined")
    returnValue.finally(() => signal.removeEventListener("abort", onCancel));
  return returnValue;
}, setIntervalPromise = function(after = 1, value, options = {}) {
  try {
    validateObject(options, "options");
  } catch (error) {
    return asyncIterator({
      next: function() {
        return Promise.reject(error);
      }
    });
  }
  const { signal, ref: reference = !0 } = options;
  try {
    validateAbortSignal(signal, "options.signal");
  } catch (error) {
    return asyncIterator({
      next: function() {
        return Promise.reject(error);
      }
    });
  }
  try {
    validateBoolean(reference, "options.ref");
  } catch (error) {
    return asyncIterator({
      next: function() {
        return Promise.reject(error);
      }
    });
  }
  if (signal?.aborted)
    return asyncIterator({
      next: function() {
        return Promise.reject(new AbortError);
      }
    });
  let onCancel, interval;
  try {
    let notYielded = 0, callback;
    if (interval = setInterval(() => {
      if (notYielded++, callback)
        callback(), callback = void 0;
    }, after), !reference)
      interval?.unref?.();
    if (signal)
      onCancel = () => {
        if (clearInterval(interval), callback)
          callback(), callback = void 0;
      }, signal.addEventListener("abort", onCancel);
    return asyncIterator({
      next: function() {
        return new Promise((resolve, reject) => {
          if (!signal?.aborted)
            if (notYielded === 0)
              callback = resolve;
            else
              resolve();
          else if (notYielded === 0)
            reject(new AbortError);
          else
            resolve();
        }).then(() => {
          if (notYielded > 0)
            return notYielded = notYielded - 1, { done: !1, value };
          return { done: !0 };
        });
      },
      return: function() {
        return clearInterval(interval), signal?.removeEventListener("abort", onCancel), Promise.resolve({});
      }
    });
  } catch (error) {
    return asyncIterator({
      next: function() {
        clearInterval(interval), signal?.removeEventListener("abort", onCancel);
      }
    });
  }
}, symbolAsyncIterator = Symbol.asyncIterator;

class ERR_INVALID_ARG_TYPE extends Error {
  constructor(name, expected, actual) {
    super(`${name} must be ${expected}, ${typeof actual} given`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

class AbortError extends Error {
  constructor() {
    super("The operation was aborted");
    this.code = "ABORT_ERR";
  }
}
export {
  setTimeoutPromise as setTimeout,
  setIntervalPromise as setInterval,
  setImmediatePromise as setImmediate
};
