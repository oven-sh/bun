// Microbenchmark: create + end spans, native vs @opentelemetry/sdk-trace-base.
// Exporters are no-ops on both sides so this measures span bookkeeping only.
import { bench, group, run } from "mitata";

const MODE = process.env.MODE ?? (typeof Bun !== "undefined" && Bun.otel ? "both" : "sdk");

let nativeTracer;
if (MODE !== "sdk" && typeof Bun !== "undefined" && Bun.otel) {
  Bun.otel.start({ exporters: [{ exportProtobuf() {} }], instrumentations: [], batch: { maxQueueSize: 1 << 30, maxExportBatchSize: 8192 } });
  nativeTracer = Bun.otel.tracer("bench");
}

const { BasicTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
const api = await import("@opentelemetry/api");
class NoopExporter { export(_s, cb) { cb({ code: 0 }); } shutdown() { return Promise.resolve(); } }
const provider = new BasicTracerProvider({ spanProcessors: [new BatchSpanProcessor(new NoopExporter(), { maxQueueSize: 1 << 30, maxExportBatchSize: 8192 })] });
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
