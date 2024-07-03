export function timerify(fn: Function, options) {
  const { histogram } = options;

  // create histogram class
  class Histogram {
    record(duration: number) {
      console.log(`Recording duration: ${duration}`);
    }
  }

  // wrap fn in a timer and return the wrapped function
  return function (...args: any[]) {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();

    if (histogram) {
      histogram.record(Math.ceil((end - start) * 1e6));
    }
    return result;
  };
}
