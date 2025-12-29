// Microtask Memory Efficiency Benchmark
// Measures memory usage when many microtasks are queued simultaneously

const formatBytes = bytes => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
};

const gc = () => {
  if (typeof Bun !== "undefined") {
    Bun.gc(true);
  } else if (typeof global !== "undefined" && global.gc) {
    global.gc();
  }
};

// Measure baseline memory
gc();
await new Promise(r => setTimeout(r, 100));
gc();
const baseline = process.memoryUsage();

console.log("=== Microtask Memory Benchmark ===\n");
console.log(`Baseline RSS: ${formatBytes(baseline.rss)}`);
console.log(`Baseline Heap Used: ${formatBytes(baseline.heapUsed)}`);
console.log("");

// Test different queue sizes
const testSizes = [10_000, 50_000, 100_000, 500_000, 1_000_000];

for (const size of testSizes) {
  gc();
  await new Promise(r => setTimeout(r, 50));

  const beforeMem = process.memoryUsage();

  // Create a promise that will resolve when all microtasks complete
  let resolveAll;
  const allDone = new Promise(r => {
    resolveAll = r;
  });

  let completed = 0;
  const startTime = performance.now();

  // Queue many microtasks at once
  for (let i = 0; i < size; i++) {
    queueMicrotask(() => {
      completed++;
      if (completed === size) {
        resolveAll();
      }
    });
  }

  // Measure memory while tasks are queued (before they execute)
  const duringMem = process.memoryUsage();

  // Wait for all microtasks to complete
  await allDone;

  const elapsed = performance.now() - startTime;

  gc();
  await new Promise(r => setTimeout(r, 50));
  const afterMem = process.memoryUsage();

  const memIncrease = duringMem.rss - beforeMem.rss;
  const heapIncrease = duringMem.heapUsed - beforeMem.heapUsed;
  const bytesPerTask = memIncrease / size;
  const heapBytesPerTask = heapIncrease / size;

  console.log(`--- ${size.toLocaleString()} tasks ---`);
  console.log(`  Time: ${elapsed.toFixed(2)}ms`);
  console.log(`  RSS increase: ${formatBytes(memIncrease)} (${bytesPerTask.toFixed(1)} bytes/task)`);
  console.log(`  Heap increase: ${formatBytes(heapIncrease)} (${heapBytesPerTask.toFixed(1)} bytes/task)`);
  console.log("");
}

// Test with Promise chains (different microtask type)
console.log("=== Promise Chain Memory Test ===\n");

for (const chainLength of [10_000, 50_000, 100_000]) {
  gc();
  await new Promise(r => setTimeout(r, 50));

  const beforeMem = process.memoryUsage();
  const startTime = performance.now();

  // Create a long promise chain
  let p = Promise.resolve(0);
  for (let i = 0; i < chainLength; i++) {
    p = p.then(v => v + 1);
  }

  const duringMem = process.memoryUsage();

  await p;

  const elapsed = performance.now() - startTime;

  gc();
  const afterMem = process.memoryUsage();

  const memIncrease = duringMem.rss - beforeMem.rss;
  const bytesPerPromise = memIncrease / chainLength;

  console.log(`--- Promise chain x${chainLength.toLocaleString()} ---`);
  console.log(`  Time: ${elapsed.toFixed(2)}ms`);
  console.log(`  RSS increase: ${formatBytes(memIncrease)} (${bytesPerPromise.toFixed(1)} bytes/promise)`);
  console.log("");
}

// Test with thenables (triggers PromiseResolveThenableJob)
console.log("=== Thenable Memory Test ===\n");

for (const count of [10_000, 50_000, 100_000]) {
  gc();
  await new Promise(r => setTimeout(r, 50));

  const beforeMem = process.memoryUsage();
  const startTime = performance.now();

  const promises = [];
  for (let i = 0; i < count; i++) {
    const thenable = {
      then(resolve) {
        resolve(i);
      },
    };
    promises.push(Promise.resolve(thenable));
  }

  const duringMem = process.memoryUsage();

  await Promise.all(promises);

  const elapsed = performance.now() - startTime;

  gc();
  const afterMem = process.memoryUsage();

  const memIncrease = duringMem.rss - beforeMem.rss;
  const bytesPerThenable = memIncrease / count;

  console.log(`--- Thenable x${count.toLocaleString()} ---`);
  console.log(`  Time: ${elapsed.toFixed(2)}ms`);
  console.log(`  RSS increase: ${formatBytes(memIncrease)} (${bytesPerThenable.toFixed(1)} bytes/thenable)`);
  console.log("");
}

console.log("=== Summary ===");
gc();
await new Promise(r => setTimeout(r, 100));
const finalMem = process.memoryUsage();
console.log(`Final RSS: ${formatBytes(finalMem.rss)}`);
console.log(`Final Heap Used: ${formatBytes(finalMem.heapUsed)}`);
