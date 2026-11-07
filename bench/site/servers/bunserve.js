const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("Hello World!");
  },
});
console.log(`Bun.serve listening on port ${server.port}`);
