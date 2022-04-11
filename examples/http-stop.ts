import { serve } from "bun";

const server = serve({
  fetch(req) {
    return new Response(`Pending requests count: ${this.pendingRequests}`);
  },
});

// Stop the server after 5 seconds
setTimeout(() => {
  server.stop();
}, 5000);
