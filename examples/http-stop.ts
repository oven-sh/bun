const server = Bun.serve({
  fetch(req: Request) {
    return new Response(`Pending requests: ${this.pendingRequests}`);
  },
});

// Stop the server after 5 seconds
setTimeout(() => {
  server.stop();
}, 5000);
