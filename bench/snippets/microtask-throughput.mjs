import { AsyncLocalStorage } from "node:async_hooks";
import { bench, group, run } from "../runner.mjs";

// Benchmark 1: queueMicrotask throughput
// Tests the BunPerformMicrotaskJob handler path directly.
// The optimization removes the JS trampoline and uses callMicrotask.
group("queueMicrotask throughput", () => {
  bench("queueMicrotask 1k", () => {
    return new Promise(resolve => {
      let remaining = 1000;
      const tick = () => {
        if (--remaining === 0) resolve();
        else queueMicrotask(tick);
      };
      queueMicrotask(tick);
    });
  });

  bench("queueMicrotask 10k", () => {
    return new Promise(resolve => {
      let remaining = 10000;
      const tick = () => {
        if (--remaining === 0) resolve();
        else queueMicrotask(tick);
      };
      queueMicrotask(tick);
    });
  });
});

// Benchmark 2: Promise.resolve chain
// Each .then() queues a microtask via the promise machinery.
// Benefits from smaller QueuedTask (better cache locality in the Deque).
group("Promise.resolve chain", () => {
  bench("Promise chain 1k", () => {
    let p = Promise.resolve();
    for (let i = 0; i < 1000; i++) {
      p = p.then(() => {});
    }
    return p;
  });

  bench("Promise chain 10k", () => {
    let p = Promise.resolve();
    for (let i = 0; i < 10000; i++) {
      p = p.then(() => {});
    }
    return p;
  });
});

// Benchmark 3: Promise.all (many simultaneous resolves)
// All promises resolve at once, flooding the microtask queue.
// Smaller QueuedTask = less memory, better cache utilization.
group("Promise.all simultaneous", () => {
  bench("Promise.all 1k", () => {
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(Promise.resolve(i));
    }
    return Promise.all(promises);
  });

  bench("Promise.all 10k", () => {
    const promises = [];
    for (let i = 0; i < 10000; i++) {
      promises.push(Promise.resolve(i));
    }
    return Promise.all(promises);
  });
});

// Benchmark 4: queueMicrotask with AsyncLocalStorage
// Tests the inlined async context save/restore path.
// Previously went through performMicrotaskFunction JS trampoline.
group("queueMicrotask + AsyncLocalStorage", () => {
  const als = new AsyncLocalStorage();

  bench("ALS.run + queueMicrotask 1k", () => {
    return als.run({ id: 1 }, () => {
      return new Promise(resolve => {
        let remaining = 1000;
        const tick = () => {
          als.getStore(); // force context read
          if (--remaining === 0) resolve();
          else queueMicrotask(tick);
        };
        queueMicrotask(tick);
      });
    });
  });
});

// Benchmark 5: async/await (each await queues microtasks)
group("async/await chain", () => {
  async function asyncChain(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += await Promise.resolve(i);
    }
    return sum;
  }

  bench("async/await 1k", () => asyncChain(1000));
  bench("async/await 10k", () => asyncChain(10000));
});

await run();
