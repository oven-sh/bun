export function timerify(fn: Function, options?: { histogram?: any }) {
  // histogram is an optional parameter
  const { histogram } = options || {};

  // wrap fn in a timer and return the wrapped function
  var wrapped = function (...args: any[]) {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();

    if (histogram) {
      histogram.record(Math.ceil((end - start) * 1e6));
    }
    return result;
  };

  // set the name of the wrapped function
  Object.defineProperty(wrapped, "name", {
    value: `timerified ${fn.name || "anonymous"}`,
  });

  return wrapped;
}
