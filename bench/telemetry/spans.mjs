// Microbenchmark: create + end spans, native vs @opentelemetry/sdk-trace-base.
// Exporters are no-ops on both sides so this measures span bookkeeping only.
import { bench, group, run } from "mitata";

const MODE = process.env.MODE ?? (typeof Bun !== "undefined" && Bun.otel ? "both" : "sdk");

let nativeTracer;
if (MODE !== "sdk" && typeof Bun !== "undefined" && Bun.otel) {
  Bun.otel.start({
    exporters: [{ exportProtobuf() {} }],
    instrumentations: [],
    batch: { maxQueueSize: 1 << 30, maxExportBatchSize: 8192 },
  });
  nativeTracer = Bun.otel.tracer("bench");
}

const { BasicTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
const api = await import("@opentelemetry/api");
class NoopExporter {
  export(_s, cb) {
    cb({ code: 0 });
  }
  shutdown() {
    return Promise.resolve();
  }
}
const provider = new BasicTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new NoopExporter(), { maxQueueSize: 1 << 30, maxExportBatchSize: 8192 })],
});
// Don't register globally when native is active (Bun already did); use the provider directly.
const sdkTracer = provider.getTracer("bench");
const cm = new AsyncLocalStorageContextManager().enable();

group("startSpan + 3 attributes + end", () => {
  if (nativeTracer)
    bench("Bun.otel", () => {
      const s = nativeTracer.startSpan("op");
      s.setAttribute("a", 1);
      s.setAttribute("b", "str");
      s.setAttribute("c", true);
      s.end();
    });
  bench("sdk-trace-base", () => {
    const s = sdkTracer.startSpan("op");
    s.setAttribute("a", 1);
    s.setAttribute("b", "str");
    s.setAttribute("c", true);
    s.end();
  });
});

// The Bun-native shapes vs the OTEL-style equivalent on the same runtime.
function work(a, b) {
  return a * b + 1;
}
if (nativeTracer) {
  group("trace a sync function call (span around work(a, b))", () => {
    bench("plain call (no span)", () => work(3, 4));
    const wrapped = Bun.otel.wrap("work", work);
    bench("Bun.otel.wrap", () => wrapped(3, 4));
    bench("Bun.otel.span(name, fn)", () => Bun.otel.span("work", () => work(3, 4)));
    bench("using Bun.otel.span(name)", () => {
      using s = Bun.otel.span("work");
      return work(3, 4);
    });
    bench("tracer.startActiveSpan(name, fn) + end (OTEL style)", () =>
      nativeTracer.startActiveSpan("work", span => {
        try {
          return work(3, 4);
        } finally {
          span.end();
        }
      }),
    );
    bench("sdk-trace-base startActiveSpan + end", () =>
      sdkTracer.startActiveSpan("work", span => {
        try {
          return work(3, 4);
        } finally {
          span.end();
        }
      }),
    );
  });

  group("… with 2 attributes", () => {
    const wrapped = Bun.otel.wrap("work", (a, b) => {
      Bun.otel.set("a", a);
      Bun.otel.set("b", b);
      return work(a, b);
    });
    bench("Bun.otel.wrap + Bun.otel.set ×2", () => wrapped(3, 4));
    bench("Bun.otel.span(name, {a, b}, fn)", () => Bun.otel.span("work", { a: 3, b: 4 }, () => work(3, 4)));
    bench("Bun.otel.span(name, fn) + span.set ×2", () =>
      Bun.otel.span("work", span => {
        span.set("a", 3);
        span.set("b", 4);
        return work(3, 4);
      }),
    );
    bench("tracer.startActiveSpan(name, {attributes}, fn) + end (OTEL style)", () =>
      nativeTracer.startActiveSpan("work", { attributes: { a: 3, b: 4 } }, span => {
        try {
          return work(3, 4);
        } finally {
          span.end();
        }
      }),
    );
    bench("sdk-trace-base startActiveSpan({attributes}) + end", () =>
      sdkTracer.startActiveSpan("work", { attributes: { a: 3, b: 4 } }, span => {
        try {
          return work(3, 4);
        } finally {
          span.end();
        }
      }),
    );
  });

  group("trace an async function (1 await inside)", () => {
    const wrapped = Bun.otel.wrap("io", async () => {
      await 0;
    });
    bench("plain async call", async () => {
      await (async () => {
        await 0;
      })();
    });
    bench("Bun.otel.wrap", async () => {
      await wrapped();
    });
    bench("Bun.otel.span(name, async fn)", async () => {
      await Bun.otel.span("io", async () => {
        await 0;
      });
    });
    bench("tracer.startActiveSpan(name, async fn) + end (OTEL style)", async () => {
      await nativeTracer.startActiveSpan("io", async span => {
        await 0;
        span.end();
      });
    });
    bench("sdk-trace-base + ALS", async () => {
      const parent = cm.active();
      const s = sdkTracer.startSpan("io", {}, parent);
      await cm.with(api.trace.setSpan(parent, s), async () => {
        await 0;
        s.end();
      });
    });
  });
}

group("startActiveSpan(fn) with 2 awaits inside", () => {
  if (nativeTracer)
    bench("Bun.otel", async () => {
      await nativeTracer.startActiveSpan("op", async s => {
        await 0;
        await 0;
        s.end();
      });
    });
  bench("sdk-trace-base + ALS", async () => {
    const parent = cm.active();
    const s = sdkTracer.startSpan("op", {}, parent);
    await cm.with(api.trace.setSpan(parent, s), async () => {
      await 0;
      await 0;
      s.end();
    });
  });
});

await run();
