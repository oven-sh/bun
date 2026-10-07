const server = Bun.serve({
  port: 0,
  tls: { cert: Bun.file(process.env.TLS_CERT || "cert.pem"), key: Bun.file(process.env.TLS_KEY || "key.pem") },
  fetch() {
    return new Response("Hello World!");
  },
});
console.log(`Bun.serve listening on port ${server.port}`);
