// Blackhole OTLP/HTTP collector: accepts and discards. Prints request/byte counts on exit.
let requests = 0, bytes = 0;
const server = Bun.serve({
  port: Number(process.env.COLLECTOR_PORT ?? 4318),
  async fetch(req) {
    requests++;
    bytes += (await req.arrayBuffer()).byteLength;
    return new Response(null, { status: 200 });
  },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { console.error(`collector: ${requests} requests, ${bytes} bytes`); process.exit(0); });
console.error(`collector listening on ${server.port}`);
