import { serve } from "bun";

serve({
  port: 9229,
  development: true,
  fetch(request, server) {
    return new Response(`Hello, ${request.url}!`);
  },
  inspector: true,
});
