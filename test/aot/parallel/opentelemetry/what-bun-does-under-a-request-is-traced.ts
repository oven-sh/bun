// Env: BUN_OTEL=1
// Env: OTEL_TRACES_EXPORTER=none
// The spans of native code, and of node:http, which has a text of its own for the compiler.
import { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";

console.log(Bun.otel.enabled);
const spans: Bun.otel.ExportedSpan[] = [];
Bun.otel.start({ exporters: [{ export: batch => void spans.push(...batch) }] });

const seen: unknown[] = [];
const downstream = http.createServer((request, response) => {
  seen.push(request.headers.tracestate, request.headers.baggage, Bun.otel.activeSpan()?.name);
  response.writeHead(201).end("made");
});
await new Promise<void>(resolve => downstream.listen(0, "127.0.0.1", resolve));
const { port } = downstream.address() as { port: number };

const server = Bun.serve({
  port: 0,
  routes: {
    "/static/*": new Response("static", { status: 202 }),
    "/orders/:id": async request => {
      Bun.otel.set("order.id", request.params.id);
      new Database(":memory:").query("select 1").get();
      statSync(process.execPath);
      try {
        readFileSync("/@missing");
      } catch {}
      await readFile("/@missing").catch(() => {});
      await (await fetch(`http://127.0.0.1:${port}/fetch`)).text();
      for (const headers of [{}, ["Host", "listed"]]) {
        await new Promise(resolve =>
          http.get({ host: "127.0.0.1", port, path: "/get", headers }, res => res.resume().on("end", resolve)),
        );
      }
      throw new RangeError("out of stock");
    },
  },
  error: () => new Response(Bun.otel.activeSpan()?.name, { status: 500 }),
});

const traceId = "0af7651916cd43dd8448eb211c80319c";
const headers = { traceparent: `00-${traceId}-b7ad6b7169203331-01`, tracestate: "vendor=1", baggage: "user=2" };
console.log(await (await fetch(server.url + "orders/9", { headers })).text());
console.log(await (await fetch(server.url + "static/a/b")).text());
console.log(seen);
await server.stop(true);
downstream.closeAllConnections();
await new Promise(resolve => downstream.close(resolve));
await Bun.otel.forceFlush();

const names = new Map(spans.map(span => [span.spanId, span.name]));
const lines = spans.map(({ scope, name, parentSpanId, traceId: id, status, attributes: a }) =>
  [scope.name, name, names.get(parentSpanId!), id === traceId, status.code, a["error.type"]]
    .concat([a["http.response.status_code"], a["url.path"], a["order.id"], a["db.query.text"]])
    .join(" | "),
);
console.log(lines.sort().join("\n"));
