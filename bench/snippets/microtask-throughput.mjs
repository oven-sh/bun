// Microtask Throughput Benchmark
// Measures raw throughput of microtask processing

import { bench, run } from "../runner.mjs";

// Test 1: queueMicrotask throughput
bench("queueMicrotask x1000", async () => {
  let completed = 0;
  await new Promise(resolve => {
    for (let i = 0; i < 1000; i++) {
      queueMicrotask(() => {
        if (++completed === 1000) resolve();
      });
    }
  });
});

// Test 2: Promise.resolve().then() throughput
bench("Promise.then x1000", async () => {
  let p = Promise.resolve();
  for (let i = 0; i < 1000; i++) {
    p = p.then(() => {});
  }
  await p;
});

// Test 3: Mixed microtask types
bench("Mixed (queue+promise) x500 each", async () => {
  let completed = 0;
  const total = 1000;
  await new Promise(resolve => {
    for (let i = 0; i < 500; i++) {
      queueMicrotask(() => {
        if (++completed === total) resolve();
      });
      Promise.resolve().then(() => {
        if (++completed === total) resolve();
      });
    }
  });
});

// Test 4: Nested async/await
bench("async/await depth 100", async () => {
  async function recurse(n) {
    if (n <= 0) return n;
    return await recurse(n - 1);
  }
  await recurse(100);
});

// Test 5: Promise.all with many promises
bench("Promise.all x100", async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(Promise.resolve(i));
  }
  await Promise.all(promises);
});

// Test 6: Thenable resolution (uses PromiseResolveThenableJob)
bench("Thenable x100", async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      Promise.resolve({
        then(r) {
          r(i);
        },
      }),
    );
  }
  await Promise.all(promises);
});

await run();
