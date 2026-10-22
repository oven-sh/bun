const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = await request.json();
    return Response.json({ doubled: body.size * 2 });
  },
});
const response = await fetch(server.url, { method: "POST", body: JSON.stringify({ size: 1.5 }) });
console.log((await response.json()).doubled + 1);
await server.stop(true);
