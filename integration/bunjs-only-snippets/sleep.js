const interval = 0.5;
const now = performance.now();
console.time("Slept");
Bun.sleep(interval);
const elapsed = performance.now() - now;
if (elapsed < interval) {
  throw new Error("Didn't sleep");
}

console.timeEnd("Slept");
