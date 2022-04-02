export function gc() {
  Bun.gc(true);
}

// we must ensure that finalizers are run
// so that the reference-counting logic is exercised
export function gcTick(trace = false) {
  trace && console.trace("");

  gc();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
