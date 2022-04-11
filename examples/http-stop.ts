const server = Bun.serve({
  fetch(req: Request) {
    return new Response(`Pending requests: ${this?.pendingRequests ?? 0}`);
  },
});

setTimeout(() => {
  // stop the server after the first request
  // when the server is stopped, this becomes undefined
  server?.stop();
  console.log("Stopping the server...");
}, 1000);
