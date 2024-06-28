export function timerify(fn: Function) {
  // wrap fn in a timer and return the wrapped function
  return function (...args: any[]) {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();
    console.log(`Function took ${end - start}ms`);
    return result;
  };
}
