// MODE=off | native | sdk. Both tracing modes go through @opentelemetry/api and export OTLP/protobuf to the same collector.
import { readFileSync } from "node:fs";
import { context, propagation, trace } from "@opentelemetry/api";

export const mode = process.env.MODE ?? "off";
const url = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318") + "/v1/traces";
const maxQueueSize = Number(process.env.QUEUE ?? 2048);
const delay = Number(process.env.DELAY ?? 5000);
const batch = Number(process.env.BATCH ?? 512);

export let flush = async () => {};

if (mode === "native") {
  const otel = (Bun as any).otel;
  trace.setGlobalTracerProvider(otel.tracerProvider);
  otel.start({
    endpoint: url,
    instrumentations: ["http"],
    batch: { maxQueueSize, delayMs: delay, maxExportBatchSize: batch },
  });
  flush = () => otel.forceFlush();
} else if (mode === "sdk") {
  const { TracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace");
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
  const exporter = new OTLPTraceExporter({ url });
  const provider = new TracerProvider({
    spanProcessors: [
      new BatchSpanProcessor({ exporter, maxQueueSize, scheduledDelayMillis: delay, maxExportBatchSize: batch }),
    ],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  flush = () => provider.forceFlush();
}

/** What the process has written to: the pages of the executable depend on the file system's cache. Linux. */
export const anonymousRss = () => Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))![1]) * 1024;

export const tracer = trace.getTracer("bench");
