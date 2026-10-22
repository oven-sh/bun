const server = Bun.serve({
  port: 0,
  fetch() {
    throw new RangeError("out of range");
  },
  error(error) {
    console.log(error instanceof RangeError, error.message.length, arguments.length);
    return new Response("handled", { status: 500 });
  },
});
const response = await fetch(server.url);
console.log(response.status + 1, await response.text());
await server.stop(true);
