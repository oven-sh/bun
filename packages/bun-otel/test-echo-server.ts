// Simple echo server for testing - returns all request headers as JSON
// Run as a separate process to avoid instrumentation
const server = Bun.serve({
  port: parseInt(process.env.PORT || "0"),
  fetch(req) {
    const url = new URL(req.url);

    // Shutdown endpoint for clean teardown
    if (url.pathname === "/shutdown") {
      server.stop();
      return new Response("shutting down", { status: 200 });
    }

    // Echo all request headers
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return Response.json({ headers });
  },
});

console.log(`Echo server listening on ${server.port}`);
