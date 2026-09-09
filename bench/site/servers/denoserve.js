Deno.serve(
  {
    port: 0,
    onListen({ port }) {
      console.log(`Deno.serve listening on port ${port}`);
    },
  },
  () => new Response("Hello World!"),
);
