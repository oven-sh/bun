// Direct measurement of QueuedTask memory overhead
// This test queues many tasks synchronously before yielding to measure peak memory

const formatMB = bytes => (bytes / 1024 / 1024).toFixed(2) + " MB";

const gc = () => {
  if (typeof Bun !== "undefined") Bun.gc(true);
};

async function measureQueueMemory(taskCount) {
  gc();
  await new Promise(r => setTimeout(r, 100));
  gc();

  const baselineRSS = process.memoryUsage().rss;

  // Create completion tracking
  let completed = 0;
  let resolveAll;
  const allDone = new Promise(r => {
    resolveAll = r;
  });

  // Queue all tasks synchronously (they won't execute until we await)
  const startTime = performance.now();
  for (let i = 0; i < taskCount; i++) {
    queueMicrotask(() => {
      if (++completed === taskCount) resolveAll();
    });
  }
  const queueTime = performance.now() - startTime;

  // Measure memory immediately after queuing (before execution)
  const peakRSS = process.memoryUsage().rss;
  const memUsed = peakRSS - baselineRSS;

  // Now let them execute
  const execStart = performance.now();
  await allDone;
  const execTime = performance.now() - execStart;

  gc();
  await new Promise(r => setTimeout(r, 50));
  const finalRSS = process.memoryUsage().rss;

  return {
    taskCount,
    memUsed,
    bytesPerTask: memUsed / taskCount,
    queueTime,
    execTime,
    peakRSS,
    finalRSS,
  };
}

console.log("=== QueuedTask Memory Measurement ===\n");

// Run multiple times and take median
async function runTest(count, runs = 5) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await measureQueueMemory(count));
    gc();
    await new Promise(r => setTimeout(r, 200));
  }

  // Sort by memory used and take median
  results.sort((a, b) => a.memUsed - b.memUsed);
  const median = results[Math.floor(results.length / 2)];

  console.log(`${count.toLocaleString()} tasks:`);
  console.log(`  Memory: ${formatMB(median.memUsed)} (${median.bytesPerTask.toFixed(1)} bytes/task)`);
  console.log(`  Queue time: ${median.queueTime.toFixed(2)}ms`);
  console.log(`  Exec time: ${median.execTime.toFixed(2)}ms`);
  console.log("");

  return median;
}

const results = [];
results.push(await runTest(100_000));
results.push(await runTest(500_000));
results.push(await runTest(1_000_000));
results.push(await runTest(2_000_000));

console.log("=== Summary ===");
const avgBytesPerTask = results.reduce((a, r) => a + r.bytesPerTask, 0) / results.length;
console.log(`Average bytes/task: ${avgBytesPerTask.toFixed(1)}`);
