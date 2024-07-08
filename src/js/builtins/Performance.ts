export function timerify(fn: Function, options?: { histogram?: any }) {
  // histogram is an optional parameter
  let { histogram } = options || {};

  if (!histogram?.record) {
    var wrapped = function wrapper() {
      return fn.$apply(this, arguments);
    };
  } else {
    // wrap fn in a timer and return the wrapped function
    var wrapped = function () {
      const start = performance.now();
      const result = fn.$apply(this, arguments);
      const end = performance.now();
      histogram.record(Math.ceil((end - start) * 1e6));
      return result;
    };
  }

  // set the name of the wrapped function
  Object.defineProperty(wrapped, "name", {
    value: `timerified ${fn.name || "anonymous"}`,
    configurable: true,
  });

  return wrapped;
}
