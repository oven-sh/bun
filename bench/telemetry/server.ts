// With MODE=sdk the handler is wrapped as an instrumentation would, with the attributes that Bun records itself.
// HOLD=1 never answers: what a request in flight holds.
import { context, propagation, ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import { anonymousRss, mode, tracer } from "./tracing.ts";

let arrived = 0;
const held: unknown[] = [];
async function handle(request: Request) {
  if (request.url.endsWith("/rss")) {
    Bun.gc(true);
    await Bun.sleep(500);
    Bun.gc(true);
    return Response.json({ rss: anonymousRss(), arrived });
  }
  arrived++;
  if (process.env.HOLD) await new Promise(resolve => held.push(resolve));
  await 0;
  await 0;
  return new Response("hello");
}

const getter = { get: (h: Headers, k: string) => h.get(k) ?? undefined, keys: (h: Headers) => [...h.keys()] };
function traced(request: Request, server: Bun.Server<undefined>) {
  const parent = propagation.extract(ROOT_CONTEXT, request.headers, getter);
  const url = new URL(request.url);
  const peer = server.requestIP(request)!;
  const attributes = {
    "http.request.method": request.method,
    "url.path": url.pathname,
    "url.scheme": "http",
    "server.address": url.hostname,
    "server.port": Number(url.port),
    "client.address": peer.address,
    "network.peer.address": peer.address,
    "network.peer.port": peer.port,
    "network.protocol.version": "1.1",
    "user_agent.original": request.headers.get("user-agent") ?? undefined,
  };
  const span = tracer.startSpan(request.method, { kind: SpanKind.SERVER, attributes }, parent);
  return context.with(trace.setSpan(parent, span), async () => {
    const response = await handle(request);
    span.setAttribute("http.response.status_code", response.status);
    span.end();
    return response;
  });
}

const server = Bun.serve({ port: 0, idleTimeout: 0, development: false, fetch: mode === "sdk" ? traced : handle });
console.log(server.port);
