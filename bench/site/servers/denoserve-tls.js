Deno.serve(
  {
    port: 0,
    cert: Deno.readTextFileSync(Deno.env.get("TLS_CERT") || "cert.pem"),
    key: Deno.readTextFileSync(Deno.env.get("TLS_KEY") || "key.pem"),
    onListen({ port }) {
      console.log(`Deno.serve listening on port ${port}`);
    },
  },
  () => new Response("Hello World!"),
);
