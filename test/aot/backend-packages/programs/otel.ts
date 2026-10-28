import { context, SpanKind, trace } from "@opentelemetry/api";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { AddressInfo } from "node:net";

const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({ serviceName: "smoke", spanProcessors: [new SimpleSpanProcessor(exporter)], instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()], autoDetectResources: false });
sdk.start();

const http: typeof import("node:http") = require("node:http");
const express: typeof import("express") = require("express");

const app = express();
app.get("/person/:id", (request, response) => {
  const active = trace.getSpan(context.active());
  response.json({ id: request.params.id, traced: active !== undefined });
});
const server = http.createServer(app);
const port = await new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

await trace.getTracer("smoke").startActiveSpan("manual", async span => {
  const text = await new Promise<string>(resolve => {
    const request = http.get({ host: "127.0.0.1", port, path: "/person/7" }, response => {
      let all = "";
      response.on("data", chunk => (all += chunk));
      response.on("end", () => resolve(all + " traceparent sent: " + (request.getHeader("traceparent") !== undefined)));
    });
  });
  console.log(text);
  span.end();
});
await new Promise<void>(resolve => server.close(() => resolve()));
const spans = exporter.getFinishedSpans();
console.log(spans.map(span => SpanKind[span.kind] + " " + span.name).sort().join(" | "));
console.log("one trace:", new Set(spans.map(span => span.spanContext().traceId)).size === 1, "spans:", spans.length);
await Promise.race([sdk.shutdown(), new Promise(resolve => setTimeout(resolve, 1000))]);
console.log("DONE");
process.exit(0);
