// Bun.serve target for the tracing overhead benchmark.
//
//   MODE=none      plain server
//   MODE=native    Bun.otel (also set BUN_OTEL=1 OTEL_EXPORTER_OTLP_ENDPOINT=...)
//   MODE=sdk       @opentelemetry/sdk-trace-base + AsyncLocalStorage context manager +
//                  OTLP/HTTP protobuf exporter, with the handler wrapped by hand the way
//                  an instrumentation library would (extract traceparent, SERVER span
//                  with the same attributes Bun records, status on 5xx).
//
// AWAITS=n adds n `await` points inside the handler (context propagation cost).
const MODE = process.env.MODE ?? "none";
const AWAITS = Number(process.env.AWAITS ?? 2);
const PORT = Number(process.env.PORT ?? 3000);

async function work() {
  let x = 0;
  for (let i = 0; i < AWAITS; i++) {
    await 0;
    x += i;
  }
  return x;
}

let handler = async req => {
  const x = await work();
  return new Response("hello " + x);
};

if (MODE === "native") {
  if (!Bun.otel.enabled) Bun.otel.start({ endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318" });
} else if (MODE === "sdk") {
  const { trace, context, propagation, SpanKind, SpanStatusCode, ROOT_CONTEXT } = require("@opentelemetry/api");
  const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
  const { AsyncLocalStorageContextManager } = require("@opentelemetry/context-async-hooks");
  const { W3CTraceContextPropagator } = require("@opentelemetry/core");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
  const { Resource } = require("@opentelemetry/resources");
  const provider = new BasicTracerProvider({
    resource: new Resource({ "service.name": "bench" }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318") + "/v1/traces" }))],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  const tracer = trace.getTracer("bench");
  const getter = { get: (h, k) => h.get(k) ?? undefined, keys: h => [...h.keys()] };
  const inner = handler;
  handler = req => {
    const parentCtx = propagation.extract(ROOT_CONTEXT, req.headers, getter);
    const url = new URL(req.url);
    const span = tracer.startSpan(
      req.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": req.method,
          "url.path": url.pathname,
          "url.scheme": "http",
          "server.address": url.hostname,
          "server.port": Number(url.port),
          "user_agent.original": req.headers.get("user-agent") ?? "",
        },
      },
      parentCtx,
    );
    return context.with(trace.setSpan(parentCtx, span), async () => {
      try {
        const res = await inner(req);
        span.setAttribute("http.response.status_code", res.status);
        if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        return res;
      } catch (e) {
        span.recordException(e);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw e;
      } finally {
        span.end();
      }
    });
  };
}

const server = Bun.serve({ port: PORT, fetch: handler, development: false });
console.error(`server (${MODE}, awaits=${AWAITS}) on ${server.port}`);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    if (MODE === "native") console.error("otel stats:", JSON.stringify(Bun.otel.stats()));
    process.exit(0);
  });
