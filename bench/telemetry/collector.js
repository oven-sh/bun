// Blackhole OTLP/HTTP collector: accepts and discards. Prints request/byte
// (and, when run under a Bun with Bun.otel, span) counts on exit.
let requests = 0, bytes = 0, spans = 0;
const decode = globalThis.Bun?.otel?.decode;
const COUNT = process.env.COUNT_SPANS === "1" && decode;
const server = Bun.serve({
  port: Number(process.env.COLLECTOR_PORT ?? 4318),
  async fetch(req) {
    requests++;
    let body = new Uint8Array(await req.arrayBuffer());
    bytes += body.byteLength;
    if (COUNT) {
      if (req.headers.get("content-encoding") === "gzip") body = Bun.gunzipSync(body);
      spans += decode(body).length;
    }
    return new Response(null, { status: 200 });
  },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { console.error(`collector: ${requests} requests, ${bytes} bytes${COUNT ? `, ${spans} spans` : ""}`); process.exit(0); });
console.error(`collector listening on ${server.port}`);
