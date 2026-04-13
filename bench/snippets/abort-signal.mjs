// Benchmark for AbortController/AbortSignal abort() performance
// Tests the optimization of skipping Event creation when no listeners are registered

import { bench, group, run } from "../runner.mjs";

// Warmup: ensure JIT compilation
for (let i = 0; i < 1000; i++) {
  const controller = new AbortController();
  controller.abort();
}

group("AbortController.abort()", () => {
  bench("no listener", () => {
    const controller = new AbortController();
    controller.abort();
  });

  bench("with addEventListener", () => {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => {});
    controller.abort();
  });

  bench("with onabort property", () => {
    const controller = new AbortController();
    controller.signal.onabort = () => {};
    controller.abort();
  });

  bench("with 3 listeners", () => {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => {});
    controller.signal.addEventListener("abort", () => {});
    controller.signal.addEventListener("abort", () => {});
    controller.abort();
  });
});

group("AbortSignal static methods", () => {
  bench("AbortSignal.abort() - pre-aborted", () => {
    const signal = AbortSignal.abort();
    // Signal is already aborted, no event dispatch needed
  });

  bench("AbortSignal.any([]) - empty array", () => {
    const signal = AbortSignal.any([]);
  });

  bench("AbortSignal.any([signal, signal]) - 2 signals", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = AbortSignal.any([a.signal, b.signal]);
  });

  bench("AbortSignal.any() then abort - no listener", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = AbortSignal.any([a.signal, b.signal]);
    a.abort();
  });

  bench("AbortSignal.any() then abort - with listener", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = AbortSignal.any([a.signal, b.signal]);
    signal.addEventListener("abort", () => {});
    a.abort();
  });
});

group("AbortController creation only", () => {
  bench("new AbortController()", () => {
    const controller = new AbortController();
  });

  bench("new AbortController() + access signal", () => {
    const controller = new AbortController();
    const signal = controller.signal;
  });
});

group("AbortSignal.timeout()", () => {
  // Note: These don't actually wait for timeout, just measure creation overhead
  bench("AbortSignal.timeout(1000) creation", () => {
    const signal = AbortSignal.timeout(1000);
  });

  bench("AbortSignal.timeout(0) creation", () => {
    const signal = AbortSignal.timeout(0);
  });
});

group("abort with reason", () => {
  bench("abort() with no reason", () => {
    const controller = new AbortController();
    controller.abort();
  });

  bench("abort() with string reason", () => {
    const controller = new AbortController();
    controller.abort("cancelled");
  });

  bench("abort() with Error reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
  });
});

await run();
