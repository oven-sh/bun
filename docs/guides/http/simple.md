---
name: Write a simple HTTP server
---

This starts an HTTP server listening on port `3000`. It responds to all requests with a `Response` with status `200` and body `"Welcome to Bun!"`.

See [`Bun.serve`](/docs/api/http) for details.

```ts
const server = Bun.serve({
  port: 3000,
  fetch(request) {
    return new Response("Welcome to Bun!");
  },
});

console.log(`Listening on localhost: ${server.port}`);
```
