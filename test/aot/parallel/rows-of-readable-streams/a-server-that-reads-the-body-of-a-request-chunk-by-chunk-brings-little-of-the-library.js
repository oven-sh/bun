// A loop over a body that came over the wire: values() makes the iterator, and a chunk of the host is a Uint8Array.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    let length = 0;
    for await (const chunk of request.body) length += chunk.length;
    setImmediate(() => {
      console.log(`${length}`);
      process.exit(0);
    });
    return new Response(String(length));
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'POST /made-up HTTP/1.1\\r\\nHost: made.up\\r\\nContent-Length: 7\\r\\n\\r\\nmade up' >&3`]);
